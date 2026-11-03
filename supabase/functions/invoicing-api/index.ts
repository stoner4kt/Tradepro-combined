// invoicing-api — the single Invoicing edge function behind every API route.
// ---------------------------------------------------------------------------
// The combined dashboard (and the standalone Invoicing-system app) call this
// function directly. It handles quotes + invoices CRUD, line items, payments,
// settings, revenue stats, email send (via Resend + email_events), PDF/view/
// download generation, broadcast/reminder helpers and CRM cross-links
// (from-project / from-lead).
//
// Auth: the CRM Worker proxies all calls with x-integration-secret (=
// INVOICING_SECRET on the Worker = INTEGRATION_SECRET on this function) and
// x-user-id. Everything is scoped by user_id. The "active" true share
// endpoints (pdf/view/download) additionally require x-api-key (= SV_API_KEY)
// — the Worker always sends both.
//
// Email events are written to invoicing.email_events; migration 0005 mirrors
// them into public.email_logs so the CRM Ledger shows them for free.
// ---------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient as supabaseCreateClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import { adminClient, checkIntegrationSecret, checkXApiKey, userIdFromRequest } from "../_shared/invoicing/supabase.ts";
import { json, methodNotAllowed } from "../_shared/invoicing/cors.ts";
import { fmtMoney, addDaysISO, todayISO, formatDate } from "../_shared/core/money.ts";
import { newDocumentId } from "../_shared/core/documentNumber.ts";
import { buildDocumentEmailHtml } from "../_shared/core/email.ts";
import {
  type Document,
  type DocumentKind,
  type DocumentLine,
  type DocumentStatus,
  QUOTE_STATUSES,
  INVOICE_STATUSES,
} from "../_shared/invoicing/invoicing.ts";

const DOC_COLUMNS =
  "id,user_id,kind,number,status,external_customer_ref,external_project_ref,external_lead_ref,customer_snapshot,issue_date,due_date,quote_valid_until,title,notes,currency,subtotal_minor,tax_minor,total_minor,amount_paid_minor,token,sent_at,meta,created_at,updated_at";
const LINE_COLUMNS =
  "id,user_id,document_id,description,quantity,unit_price_minor,sort_order,created_at";
const SETTINGS_COLUMNS =
  "id,user_id,business_name,email,phone,reply_to_email,currency,locale,tax_rate,payment_terms_days,quote_valid_days,invoice_prefix,quote_prefix,next_invoice_number,next_quote_number,bank_details,notes,created_at,updated_at";

const SETTINGS_UPDATE_FIELDS = [
  "business_name", "email", "phone", "reply_to_email", "currency", "locale",
  "tax_rate", "payment_terms_days", "quote_valid_days", "invoice_prefix",
  "quote_prefix", "bank_details", "notes",
];

const DOC_PATCH_FIELDS = [
  "external_customer_ref", "external_project_ref", "external_lead_ref",
  "customer_snapshot", "issue_date", "due_date", "quote_valid_until",
  "title", "notes", "currency",
];

const LINE_INPUT_FIELDS = ["description", "quantity", "unit_price_minor"];

const QUOTE_EMAIL_SUBJECT = (number: string) => `Your quote ${number} from {{businessName}}`;
const INVOICE_EMAIL_SUBJECT = (number: string) => `Invoice ${number} from {{businessName}}`;
const REMINDER_SUBJECT = (number: string) => `Reminder: invoice ${number} from {{businessName}}`;

interface RecalculateResult {
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
}

function recalc(lines: DocumentLine[], taxRate: number): RecalculateResult {
  const subtotal = lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unit_price_minor), 0);
  const tax = Math.round(subtotal * taxRate);
  return { subtotal_minor: subtotal, tax_minor: tax, total_minor: subtotal + tax };
}

function parseOptionalDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value);
  // Accept YYYY-MM-DD or full ISO; normalise to date-only.
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function cleanPatch(body: Document, allowed: string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (body[k as keyof Document] !== undefined) patch[k] = body[k as keyof Document];
  }
  return patch;
}

function numbersFromSnapshot(snapshot: Record<string, unknown>): { email: string; name: string } {
  const email = String((snapshot.email as string) || "").trim();
  const firstName = String((snapshot.first_name as string) || (snapshot.firstName as string) || "");
  const lastName = String((snapshot.last_name as string) || (snapshot.lastName as string) || "");
  return { email, name: [firstName, lastName].filter(Boolean).join(" ") || email };
}

function publicShareUrl(env: string | undefined, kind: DocumentKind, token: string): string {
  const base = (env || "").replace(/\/+$/, "");
  return `${base}/#/public/${kind}/${token}`;
}

async function currentSettings(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("settings").select(SETTINGS_COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getOwnedDocument(admin: SupabaseClient, userId: string, id: string) {
  const { data, error } = await admin
    .from("documents").select(DOC_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as Document | null;
}

async function getDocumentLines(admin: SupabaseClient, documentId: string) {
  const { data, error } = await admin
    .from("document_lines").select(LINE_COLUMNS)
    .eq("document_id", documentId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DocumentLine[];
}

async function fullDocument(admin: SupabaseClient, userId: string, id: string) {
  const doc = await getOwnedDocument(admin, userId, id);
  if (!doc) return null;
  const lines = await getDocumentLines(admin, id);
  return { ...doc, lines };
}

async function insertLines(admin: SupabaseClient, userId: string, documentId: string, linesIn: unknown[]) {
  const lines = (linesIn ?? []).map((raw, i) => {
    const line = (raw ?? {}) as Record<string, unknown>;
    return {
      user_id: userId,
      document_id: documentId,
      description: String(line.description ?? "").slice(0, 500),
      quantity: Math.max(0.001, Number(line.quantity ?? 1) || 1),
      unit_price_minor: Math.max(0, Math.round(Number(line.unit_price_minor ?? 0) || 0)),
      sort_order: i,
    };
  });
  if (lines.length === 0) return;
  const { error } = await admin.from("document_lines").insert(lines);
  if (error) throw error;
}

async function replaceLines(admin: SupabaseClient, userId: string, documentId: string, linesIn: unknown[]) {
  const { error: delErr } = await admin
    .from("document_lines").delete().eq("document_id", documentId).eq("user_id", userId);
  if (delErr) throw delErr;
  await insertLines(admin, userId, documentId, linesIn);
}

async function applyTotals(admin: SupabaseClient, userId: string, doc: Document, lines: DocumentLine[]) {
  const settings = await currentSettings(admin, userId) as { tax_rate: number; currency: string };
  const currency = doc.currency || settings?.currency || "USD";
  const taxRate = Number(settings?.tax_rate || 0);
  const totals = recalc(lines, taxRate);
  const { error } = await admin
    .from("documents")
    .update({
      subtotal_minor: totals.subtotal_minor,
      tax_minor: totals.tax_minor,
      total_minor: totals.total_minor,
      currency,
      updated_at: new Date().toISOString(),
    })
    .eq("id", doc.id)
    .eq("user_id", userId);
  if (error) throw error;
  return totals;
}

/**
 * Resolves a customer snapshot from the CRM tables (public schema). Uses a
 * public-schema service-role client so RLS is bypassed — the auth boundary
 * here is the x-user-id header + the .eq("user_id") scoping on every query.
 * A lookup failure (missing table in an extracted/edge-only mirror) yields
 * null and the caller falls back to an empty snapshot.
 */
async function resolveCustomerSnapshot(
  admin: SupabaseClient,
  userId: string,
  refKey: "external_customer_ref" | "external_project_ref" | "external_lead_ref",
  refValue: string,
): Promise<Record<string, unknown> | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  const svc = supabaseCreateClient(url, key, { db: { schema: "public" } });
  try {
    if (refKey === "external_customer_ref") {
      const { data } = await svc.from("clients").select("id,first_name,last_name,email,phone,address,city,state,zip,notes")
        .eq("id", refValue).eq("user_id", userId).maybeSingle();
      if (!data) return null;
      return {
        name: [data.first_name, data.last_name].filter(Boolean).join(" "),
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        phone: data.phone,
        address: { street_line1: data.address, city: data.city, state: data.state, zip: data.zip },
        note: data.notes,
      };
    }
    if (refKey === "external_project_ref") {
      const { data } = await svc
        .from("projects").select("id,title,client_id,client:clients(first_name,last_name,email,phone,address,city,state,zip)")
        .eq("id", refValue).eq("user_id", userId).maybeSingle();
      if (!data) return null;
      const c = (data as { client?: unknown }).client as Record<string, unknown> | null;
      return {
        name: c ? [c.first_name, c.last_name].filter(Boolean).join(" ") : "",
        first_name: (c?.first_name as string) || "",
        last_name: (c?.last_name as string) || "",
        email: (c?.email as string) || "",
        phone: (c?.phone as string) || "",
        address: {
          street_line1: (c?.address as string) || "",
          city: (c?.city as string) || "",
          state: (c?.state as string) || "",
          zip: (c?.zip as string) || "",
        },
        note: String(data.title || ""),
      };
    }
    const { data } = await svc.from("leads").select("id,first_name,last_name,email,phone,message")
      .eq("id", refValue).eq("user_id", userId).maybeSingle();
    if (!data) return null;
    return {
      name: [data.first_name, data.last_name].filter(Boolean).join(" "),
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      phone: data.phone,
      note: data.message,
    };
  } catch {
    return null;
  }
}

/** Small typed lookups into the CRM (public schema) used by from-project /
 * from-lead. Returns null when the row is missing or owned by someone else. */
async function crmProject(admin: SupabaseClient, userId: string, projectId: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  const svc = supabaseCreateClient(url, key, { db: { schema: "public" } });
  try {
    const { data } = await svc.from("projects").select("id,title,client_id,est_value")
      .eq("id", projectId).eq("user_id", userId).maybeSingle();
    return data ?? null;
  } catch {
    admin;
    return null;
  }
}

async function crmLead(admin: SupabaseClient, userId: string, leadId: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  const svc = supabaseCreateClient(url, key, { db: { schema: "public" } });
  try {
    const { data } = await svc.from("leads").select("id,first_name,last_name,service,message,estimated_value")
      .eq("id", leadId).eq("user_id", userId).maybeSingle();
    return data ?? null;
  } catch {
    admin;
    return null;
  }
}

/** Sends a document email via Resend and records an invoicing.email_events row. */
async function sendDocumentEmail(
  admin: SupabaseClient,
  userId: string,
  doc: Document,
  settings: { business_name: string; reply_to_email: string; email: string },
  subjectBuilder: (number: string) => string,
  bodyHtml: string,
  kind: "quote_sent" | "invoice_sent" | "reminder",
): Promise<{ message_id: string | null; status: string; to: string; subject: string } | { error: string }> {
  const { email: recipient } = numbersFromSnapshot(doc.customer_snapshot as Record<string, unknown>);
  if (!recipient) return { error: "No customer email — set the customer before sending" };

  const from = Deno.env.get("INVOICING_FROM_EMAIL") || Deno.env.get("RESEND_FROM_EMAIL");
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const businessName = settings.business_name || "your provider";
  const subject = subjectBuilder(doc.number).replace(/\{\{businessName\}\}/g, businessName);

  const emailEvent: {
    user_id: string;
    document_id: string;
    kind: "quote_sent" | "invoice_sent" | "reminder";
    to_email: string;
    subject: string;
    status: string;
    meta: Record<string, unknown>;
    message_id?: string | null;
  } = {
    user_id: userId,
    document_id: doc.id,
    kind,
    to_email: recipient,
    subject,
    status: "queued",
    meta: {},
  };

  const resend = Deno.env.get("RESEND_DISABLED_FLAG") === "true";
  if (!apiKey || resend) {
    // Dev / no-key mode: record as queued with dev_console flag so the 0005
    // ledger mirror marks it provider=console.
    emailEvent.status = "queued";
    emailEvent.meta = { dev_console: "true" };
    const { error: evErr } = await admin.from("email_events").insert(emailEvent);
    if (evErr) return { error: evErr.message };
    return { message_id: null, status: "queued", to: recipient, subject };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: recipient,
        reply_to: settings.reply_to_email || settings.email || undefined,
        subject,
        html: bodyHtml,
      }),
    });
    const resBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      emailEvent.status = "failed";
      emailEvent.meta = { error: String((resBody as { message?: string }).message || res.status) };
    } else {
      emailEvent.status = "sent";
      emailEvent.message_id = (resBody as { id?: string }).id || null;
    }
  } catch (err) {
    emailEvent.status = "failed";
    emailEvent.meta = { error: (err as Error).message };
  }

  const { error: evErr } = await admin.from("email_events").insert(emailEvent);
  if (evErr) return { error: evErr.message };
  return {
    message_id: emailEvent.message_id ?? null,
    status: emailEvent.status,
    to: recipient,
    subject,
  };
}

// PDF generation is intentionally implemented as print-friendly HTML so the
// same content renders in the viewer, the download and the print dialog.

function documentPaymentLink(doc: Document): string {
  return publicShareUrl(Deno.env.get("APP_URL"), doc.kind, doc.token);
}

function paymentStatusLabel(doc: Document): string {
  if (doc.kind !== "invoice") return doc.status.replace(/_/g, " ");
  if (doc.status === "paid") return "Paid";
  if (doc.amount_paid_minor > 0 && doc.amount_paid_minor < doc.total_minor) return "Partially paid";
  return doc.status.replace(/_/g, " ");
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  const method = req.method;
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return methodNotAllowed();

  if (!checkIntegrationSecret(req)) return json({ error: "Unauthorized" }, 401);
  const userId = userIdFromRequest(req);
  if (!userId) return json({ error: "x-user-id header is required" }, 400);

  let admin: SupabaseClient;
  try {
    admin = adminClient();
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }

  const url = new URL(req.url);
  // Path layout: /functions/v1/invoicing-api/<rest...>
  const rel = url.pathname.split("/").filter(Boolean).slice(3);

  try {
    // ------- GET /  (dashboard: settings + recent documents) -------
    if (method === "GET" && rel.length === 0) {
      const [settings, docsRes] = await Promise.all([
        currentSettings(admin, userId),
        admin.from("documents").select(DOC_COLUMNS).eq("user_id", userId)
          .order("created_at", { ascending: false }).limit(20),
      ]);
      if (docsRes.error) throw docsRes.error;
      const docs = (docsRes.data ?? []) as Document[];
      const withLines = await Promise.all(docs.map(async (d) => ({ ...d, lines: await getDocumentLines(admin, d.id) })));
      return json({ settings, documents: withLines });
    }

    // ------- /settings -------
    if (rel[0] === "settings" && rel.length === 1) {
      if (method === "GET") {
        const settings = await currentSettings(admin, userId);
        if (!settings) {
          const { data: created, error } = await admin.from("settings").insert({ user_id: userId }).select(SETTINGS_COLUMNS).single();
          if (error) throw error;
          return json({ settings: created });
        }
        return json({ settings });
      }
      if (method === "PUT") {
        let body: Record<string, unknown>;
        try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const k of SETTINGS_UPDATE_FIELDS) if (body[k] !== undefined) patch[k] = body[k];
        const existing = await currentSettings(admin, userId);
        const { data, error } = existing
          ? await admin.from("settings").update(patch).eq("id", existing.id).eq("user_id", userId).select(SETTINGS_COLUMNS).single()
          : await admin.from("settings").insert({ user_id: userId, ...patch }).select(SETTINGS_COLUMNS).single();
        if (error) throw error;
        return json({ settings: data });
      }
      return methodNotAllowed();
    }

    // ------- /documents -------
    if (rel[0] === "documents") {
      const id = rel[1];

      // ---- constructor actions (from-project / from-lead) ----
      // These live at /documents/from-project|from-lead (collection-level) and
      // must run before the item branch — rel[1] is "from-project", not an id.
      if (id === "from-project" || id === "from-lead") {
        if (method !== "POST") return methodNotAllowed();
        const isProject = id === "from-project";
        const refKey = isProject ? "external_project_ref" : "external_lead_ref";
        const refId = String(url.searchParams.get(isProject ? "projectId" : "leadId") || url.searchParams.get("id") || "");
        if (!refId) return json({ error: `${isProject ? "projectId" : "leadId"} query parameter is required` }, 400);
        const snap = await resolveCustomerSnapshot(admin, userId, refKey, refId);
        if (!snap) return json({ error: isProject ? "Project not found or has no client" : "Lead not found" }, 404);
        const kind = String(url.searchParams.get("kind") || "quote") === "invoice" ? "invoice" as const : "quote" as const;
        const row = isProject ? await crmProject(admin, userId, refId) : await crmLead(admin, userId, refId);

        const { id: newId } = await newDocumentId(admin, userId, kind);
        // newDocumentId already persists a provisional row with the kind set.
        const patch: Record<string, unknown> = {
          [refKey]: refId,
          customer_snapshot: snap,
        };
        if (isProject) {
          const project = row as { title?: string; client_id?: string; est_value?: number } | null;
          patch.external_customer_ref = project?.client_id || null;
          patch.title = project?.title ? `Quote — ${project.title}` : "Quote";
          if (project?.est_value) {
            await insertLines(admin, userId, newId, [{ description: project.title || "Project", quantity: 1, unit_price_minor: Math.round(Number(project.est_value) * 100) }]);
          }
        } else {
          const lead = row as { service?: string; message?: string; estimated_value?: number } | null;
          patch.title = lead?.service ? `Quote — ${lead.service}` : "Quote";
          patch.notes = lead?.message || "";
          if (lead?.estimated_value) {
            await insertLines(admin, userId, newId, [{ description: lead.service || "Service", quantity: 1, unit_price_minor: Math.round(Number(lead.estimated_value) * 100) }]);
          }
        }

        const settings = await currentSettings(admin, userId);
        if (kind === "quote") {
          patch.quote_valid_until = addDaysISO(todayISO(), Number(settings?.quote_valid_days || 30));
        } else {
          patch.due_date = addDaysISO(todayISO(), Number(settings?.payment_terms_days || 14));
        }

        const { error } = await admin.from("documents").update(patch).eq("id", newId).eq("user_id", userId);
        if (error) throw error;
        const done = await fullDocument(admin, userId, newId);
        if (done) await applyTotals(admin, userId, done, done.lines);
        return json({ document: await fullDocument(admin, userId, newId) }, 201);
      }

      // ---- collection ----
      if (!id) {
        if (method === "GET") {
          let q = admin.from("documents").select(DOC_COLUMNS).eq("user_id", userId);
          const kind = url.searchParams.get("kind");
          const status = url.searchParams.get("status");
          if (kind === "quote" || kind === "invoice") q = q.eq("kind", kind);
          if (status) q = q.eq("status", status);
          const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
          const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
          const { data, error } = await q
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);
          if (error) throw error;
          const docs = (data ?? []) as Document[];
          const withLines = await Promise.all(docs.map(async (d) => ({ ...d, lines: await getDocumentLines(admin, d.id) })));
          return json({ documents: withLines, count: withLines.length });
        }
        if (method === "POST") {
          let body: Record<string, unknown>;
          try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
          const kind = body.kind === "invoice" ? "invoice" : "quote";
          const { id: newId, number } = await newDocumentId(admin, userId, kind);
          const patch: Record<string, unknown> = {};
          for (const k of DOC_PATCH_FIELDS) if (body[k] !== undefined) patch[k] = body[k];
          if (patch.external_customer_ref) {
            const snap = await resolveCustomerSnapshot(admin, userId, "external_customer_ref", String(patch.external_customer_ref));
            if (snap) patch.customer_snapshot = snap;
          }
          const { error } = await admin.from("documents")
            .update(patch)
            .eq("id", newId)
            .eq("user_id", userId);
          if (error) throw error;
          await insertLines(admin, userId, newId, Array.isArray(body.lines) ? body.lines : []);
          const done = await fullDocument(admin, userId, newId);
          if (done) await applyTotals(admin, userId, done, done.lines);
          const refreshed = await fullDocument(admin, userId, newId);
          return json({ document: refreshed }, 201);
        }
        return methodNotAllowed();
      }

      // ---- item ----
      const doc = await getOwnedDocument(admin, userId, id);
      if (!doc) return json({ error: "Document not found" }, 404);

      if (method === "GET" && rel.length === 2) {
        const lines = await getDocumentLines(admin, id);
        return json({ document: { ...doc, lines } });
      }

      if (method === "DELETE" && rel.length === 2) {
        if (doc.status === "draft") {
          const { error } = await admin.from("documents").delete().eq("id", id).eq("user_id", userId);
          if (error) throw error;
          return json({ ok: true });
        }
        // Non-draft: mark void.
        const { error } = await admin.from("documents")
          .update({ status: "void", updated_at: new Date().toISOString() })
          .eq("id", id).eq("user_id", userId);
        if (error) throw error;
        return json({ ok: true });
      }

      if (method === "PATCH" && rel.length === 2) {
        let body: Record<string, unknown>;
        try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        const patch: Record<string, unknown> = {};
        for (const k of DOC_PATCH_FIELDS) if (body[k] !== undefined) patch[k] = body[k];
        if (body.issue_date !== undefined) patch.issue_date = parseOptionalDate(body.issue_date);
        if (body.due_date !== undefined) patch.due_date = parseOptionalDate(body.due_date);
        if (body.quote_valid_until !== undefined) patch.quote_valid_until = parseOptionalDate(body.quote_valid_until);
        if (body.status !== undefined && validNextStatus(doc, String(body.status))) {
          patch.status = String(body.status);
        }
        if (patch.external_customer_ref && !patch.customer_snapshot) {
          const snap = await resolveCustomerSnapshot(admin, userId, "external_customer_ref", String(patch.external_customer_ref));
          if (snap) patch.customer_snapshot = snap;
        }
        if (body.customer_snapshot) patch.customer_snapshot = body.customer_snapshot;
        if (body.title !== undefined) patch.title = String(body.title).slice(0, 300);
        if (body.notes !== undefined) patch.notes = String(body.notes).slice(0, 4000);
        patch.updated_at = new Date().toISOString();
        const { error } = await admin.from("documents").update(patch).eq("id", id).eq("user_id", userId);
        if (error) throw error;
        if (Array.isArray(body.lines)) {
          await replaceLines(admin, userId, id, body.lines);
        }
        const updated = await fullDocument(admin, userId, id);
        if (updated) await applyTotals(admin, userId, updated, updated.lines);
        return json({ document: await fullDocument(admin, userId, id) });
      }

      // ---- actions ----
      const action = rel[2];

      if (method === "POST" && action === "send") {
        let body: Record<string, unknown> = {};
        try { body = await req.json(); } catch { /* optional body */ }
        const settings = await currentSettings(admin, userId) as { business_name: string; reply_to_email: string; email: string };
        const recipient = numbersFromSnapshot(doc.customer_snapshot as Record<string, unknown>).email;
        if (!recipient) return json({ error: "No customer email — set the customer before sending" }, 400);
        const totals = {
          total_label: fmtMoney(doc.total_minor, { currency: doc.currency }),
          due_label: doc.kind === "quote"
            ? formatDate(doc.quote_valid_until)
            : formatDate(doc.due_date),
        };
        const html = buildDocumentEmailHtml({
          businessName: settings.business_name,
          customerName: numbersFromSnapshot(doc.customer_snapshot as Record<string, unknown>).name,
          title: doc.title,
          number: doc.number,
          kind: doc.kind,
          totalLabel: totals.total_label,
          dueLabel: totals.due_label,
          replyToEmail: settings.reply_to_email || settings.email,
          primaryUrl: documentPaymentLink(doc),
        });
        const kind = doc.kind === "quote" ? "quote_sent" as const : "invoice_sent" as const;
        const result = await sendDocumentEmail(
          admin, userId, doc, settings,
          doc.kind === "quote" ? QUOTE_EMAIL_SUBJECT : INVOICE_EMAIL_SUBJECT,
          html,
          kind,
        );
        if ("error" in result) return json({ error: result.error }, 400);
        // Flip status on a successful first send.
        await admin.from("documents").update({
          status: doc.kind === "quote" ? "sent" : "issued",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", id).eq("user_id", userId);
        if (body.reset_review_after) {
          await admin.from("documents").update({ meta: { ...(doc.meta || {}), review_after: new Date().toISOString() } })
            .eq("id", id).eq("user_id", userId);
        }
        return json({ ok: true, email: result });
      }

      if (method === "POST" && action === "accept") {
        if (doc.kind !== "quote") return json({ error: "Only quotes can be accepted" }, 400);
        const { error } = await admin.from("documents")
          .update({ status: "accepted", updated_at: new Date().toISOString() })
          .eq("id", id).eq("user_id", userId);
        if (error) throw error;
        // The 0005 trigger moves the linked CRM lead to won / project to
        // scheduled automatically.
        await admin.from("email_events").insert({
          user_id: userId, document_id: id, kind: "quote_sent",
          to_email: String((doc.customer_snapshot as Record<string, unknown>).email || "customer@sender.invalid"),
          subject: "Quote accepted",
          status: "queued", meta: { dev_console: "true", accepted_log: "true" },
        }).then(() => undefined, () => undefined);
        return json({ ok: true, status: "accepted" });
      }

      if (method === "POST" && action === "decline") {
        if (doc.kind !== "quote") return json({ error: "Only quotes can be declined" }, 400);
        const { error } = await admin.from("documents")
          .update({ status: "declined", updated_at: new Date().toISOString() })
          .eq("id", id).eq("user_id", userId);
        if (error) throw error;
        return json({ ok: true, status: "declined" });
      }

      if (method === "POST" && action === "mark-paid") {
        if (doc.kind !== "invoice") return json({ error: "Only invoices can be marked paid" }, 400);
        const { error } = await admin.from("documents")
          .update({ status: "paid", amount_paid_minor: doc.total_minor, updated_at: new Date().toISOString() })
          .eq("id", id).eq("user_id", userId);
        if (error) throw error;
        await admin.from("email_events").insert({
          user_id: userId, document_id: id, kind: "payment_received",
          to_email: String((doc.customer_snapshot as Record<string, unknown>).email || "customer@sender.invalid"),
          subject: "Payment received",
          status: "queued", meta: { dev_console: "true" },
        }).then(() => undefined, () => undefined);
        return json({ ok: true, status: "paid" });
      }

      // ---- payments sub-resource ----
      if (action === "payments" && method === "POST") {
        if (doc.kind !== "invoice") return json({ error: "Only invoices accept payments" }, 400);
        let body: Record<string, unknown>;
        try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        const amount = Math.max(1, Math.round(Number(body.amount_minor ?? 0) || 0));
        const methodValue = ["cash", "card", "bank", "check", "other"].includes(String(body.method)) ? String(body.method) : "other";
        const { data: pay, error } = await admin.from("payments").insert({
          user_id: userId, document_id: id, amount_minor: amount,
          method: methodValue, notes: String(body.notes ?? "").slice(0, 500),
        }).select("*").single();
        if (error) throw error;
        const paid = Math.min(doc.amount_paid_minor + amount, doc.total_minor);
        const status = paid >= doc.total_minor ? "paid" : "partially_paid";
        await admin.from("documents").update({ amount_paid_minor: paid, status, updated_at: new Date().toISOString() })
          .eq("id", id).eq("user_id", userId);
        await admin.from("email_events").insert({
          user_id: userId, document_id: id, kind: "payment_received",
          to_email: String((doc.customer_snapshot as Record<string, unknown>).email || "customer@sender.invalid"),
          subject: "Payment received",
          status: "queued", meta: { dev_console: "true" },
        }).then(() => undefined, () => undefined);
        return json({ payment: pay }, 201);
      }

      if (action === "payments" && method === "GET") {
        const { data, error } = await admin.from("payments").select("*")
          .eq("document_id", id).eq("user_id", userId).order("received_at", { ascending: false });
        if (error) throw error;
        return json({ payments: data ?? [] });
      }

      // ---- pdf / view / download (active=true share endpoints) ----
      if (action === "pdf" || action === "view" || action === "download") {
        const active = url.searchParams.get("active") !== "false";
        if (active && !checkXApiKey(req)) return json({ error: "Forbidden" }, 403);
        const lines = await getDocumentLines(admin, id);
        const htmlDoc = renderDocumentHtml(doc, lines);
        const asDownload = action === "download";
        return new Response(htmlDoc, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            ...(asDownload
              ? { "Content-Disposition": `attachment; filename="${(doc.number || "document").replace(/[^a-zA-Z0-9._-]/g, "_")}.html"` }
              : {}),
          },
        });
      }

      return methodNotAllowed();
    }

    // ------- /payments/:id (DELETE) -------
    if (rel[0] === "payments" && rel[1] && method === "DELETE") {
      const { data: pay, error } = await admin.from("payments").select("document_id,amount_minor,user_id")
        .eq("id", rel[1]).eq("user_id", userId).maybeSingle();
      if (error) throw error;
      if (!pay) return json({ error: "Payment not found" }, 404);
      await admin.from("payments").delete().eq("id", rel[1]).eq("user_id", userId);
      // Recompute amount paid from remaining payments.
      const { data: remaining } = await admin.from("payments").select("amount_minor")
        .eq("document_id", pay.document_id).eq("user_id", userId);
      const paid = (remaining ?? []).reduce((s, r) => s + r.amount_minor, 0);
      const docRow = await getOwnedDocument(admin, userId, pay.document_id);
      const status = docRow && paid >= docRow.total_minor ? "paid"
        : paid > 0 ? "partially_paid"
        : docRow ? "issued" : "issued";
      await admin.from("documents").update({ amount_paid_minor: paid, status, updated_at: new Date().toISOString() })
        .eq("id", pay.document_id).eq("user_id", userId);
      return json({ ok: true });
    }

    // ------- /revenue -------
    if (rel[0] === "revenue" && method === "GET") {
      const { data, error } = await admin.from("documents").select(DOC_COLUMNS)
        .eq("user_id", userId).eq("kind", "invoice");
      if (error) throw error;
      const invoices = (data ?? []) as Document[];
      const totalBilled = invoices.reduce((s, d) => s + d.total_minor, 0);
      const totalPaid = invoices.reduce((s, d) => s + d.amount_paid_minor, 0);
      const open = invoices.filter((d) => d.status === "issued" || d.status === "partially_paid" || d.status === "overdue");
      return json({
        totals: {
          invoiced: totalBilled,
          paid: totalPaid,
          outstanding: totalBilled - totalPaid,
          document_count: invoices.length,
          open_count: open.length,
        },
      });
    }

    // ------- /reminders (helper used by the cron function) -------
    if (rel[0] === "reminders" && method === "GET") {
      const overdueDays = Math.max(1, Number(url.searchParams.get("days") || 7));
      const cutoff = new Date(Date.now() - overdueDays * 86400000).toISOString();
      const { data, error } = await admin
        .from("documents").select(DOC_COLUMNS)
        .eq("user_id", userId).eq("kind", "invoice")
        .in("status", ["issued", "partially_paid", "overdue"])
        .lt("due_date", todayISO())
        .or(`sent_at.lt.${cutoff},sent_at.is.null`);
      if (error) throw error;
      return json({ documents: data ?? [] });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});

function validNextStatus(doc: Document, status: string): boolean {
  if (doc.kind === "quote") return QUOTE_STATUSES.includes(status as DocumentStatus);
  return INVOICE_STATUSES.includes(status as DocumentStatus);
}

/** Renders a printable HTML document (used by pdf/view/download + public page). */
function renderDocumentHtml(doc: Document, lines: DocumentLine[]): string {
  const name = String((doc.customer_snapshot as Record<string, unknown>).name || "Customer");
  const currency = doc.currency || "USD";
  const lineRows = lines.length
    ? lines.map((l, i) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">${escapeHtml(l.description || `Item ${i + 1}`)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;">${l.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;">${fmtMoney(l.unit_price_minor, { currency })}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;">${fmtMoney(l.quantity * l.unit_price_minor, { currency })}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" style="padding:12px 0;color:#94a3b8;text-align:center;">No line items</td></tr>`;
  const statusBadge = paymentStatusLabel(doc);
  const title = doc.kind === "quote" ? "Quote" : "Invoice";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(doc.number)} — ${title}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; background: #e2e8f0; color: #0f172a; }
  .sheet { max-width: 800px; margin: 24px auto; background: #fff; padding: 40px 48px; box-shadow: 0 1px 3px rgba(15,23,42,.12); border-radius: 8px; }
  h1 { margin: 0; font-size: 24px; }
  .muted { color: #64748b; }
  .meta { display: flex; justify-content: space-between; margin: 24px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th { text-align: left; font-size: 12px; text-transform: uppercase; color: #94a3b8; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; }
  th.r, td.r { text-align: right; }
  .totals { margin-top: 24px; margin-left: auto; width: 260px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
  .grand { font-size: 18px; font-weight: bold; border-top: 2px solid #e2e8f0; margin-top: 8px; padding-top: 10px; }
  .badge { display: inline-block; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 9999px; background: #dbeafe; color: #1e40af; }
  @media print { body { background: #fff; } .sheet { box-shadow: none; margin: 0; border-radius: 0; padding: 24px; } }
</style>
</head>
<body>
  <div class="sheet">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <h1>${title} <span class="muted">${escapeHtml(doc.number)}</span></h1>
        <div class="muted" style="margin-top:4px;">${escapeHtml(doc.title || "")}</div>
      </div>
      <span class="badge">${escapeHtml(statusBadge)}</span>
    </div>
    <div class="meta">
      <div>
        <div class="muted" style="font-size:12px;">BILL TO</div>
        <div style="font-weight:600;margin-top:2px;">${escapeHtml(name)}</div>
        ${doc.due_date ? `<div class="muted" style="margin-top:6px;">${doc.kind === "quote" ? "Valid until" : "Due"}: <strong>${formatDate(doc.due_date)}</strong></div>` : ""}
        ${doc.quote_valid_until ? `<div class="muted" style="margin-top:6px;">Valid until: <strong>${formatDate(doc.quote_valid_until)}</strong></div>` : ""}
      </div>
      <div>
        <div class="muted" style="font-size:12px;text-align:right;">ISSUED</div>
        <div style="margin-top:2px;text-align:right;">${formatDate(doc.issue_date || doc.created_at)}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
    <div class="totals">
      <div><span class="muted">Subtotal</span><span>${fmtMoney(doc.subtotal_minor, { currency })}</span></div>
      <div><span class="muted">Tax</span><span>${fmtMoney(doc.tax_minor, { currency })}</span></div>
      <div class="grand"><span>Total</span><span>${fmtMoney(doc.total_minor, { currency })}</span></div>
      ${doc.kind === "invoice" && doc.amount_paid_minor > 0 ? `<div><span class="muted">Paid</span><span>${fmtMoney(doc.amount_paid_minor, { currency })}</span></div>` : ""}
      ${doc.kind === "invoice" && doc.amount_paid_minor > 0 && doc.amount_paid_minor < doc.total_minor
        ? `<div><span class="muted">Balance due</span><span>${fmtMoney(doc.total_minor - doc.amount_paid_minor, { currency })}</span></div>` : ""}
    </div>
    ${doc.notes ? `<div class="muted" style="margin-top:24px;font-size:13px;">${escapeHtml(doc.notes)}</div>` : ""}
    <div class="muted" style="margin-top:32px;font-size:11px;text-align:center;">Generated by TradePro Invoicing</div>
  </div>
</body>
</html>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-api-key, x-integration-secret, x-internal-call, x-user-id, x-widget-key, x-app-apikey",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};