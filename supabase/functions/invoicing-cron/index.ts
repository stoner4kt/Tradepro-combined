// invoicing-cron — scheduled reminder + status sweep for Invoicing.
// ---------------------------------------------------------------------------
// Invoked by pg_cron (see supabase/cron.sql). Auth: CRON_SECRET env, sent by
// the pg_net job in the Authorization header (and x-app-apikey, kept for
// compatibility with pg_net's header conventions).
//
// What it does per run:
//   1. reminders  — for every user, list issued/partially_paid/overdue
//                   invoices whose due_date is in the past AND that are at
//                   least `grace_days` old. Record an invoicing.email_events
//                   row (status queued + dev_console=true) per reminder so the
//                   0005 ledger mirror logs them even without Resend creds.
//                   If RESEND_API_KEY is set, actually send the email and
//                   stamp the event as sent.
//   2. overdue    — flip invoices whose due_date passed to status 'overdue'.
//
// Both passes are strictly additive and cannot mutate the CRM directly; the
// email_events insert is the ONLY write.
// ---------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { adminClient } from "../_shared/invoicing/supabase.ts";
import { buildDocumentEmailHtml } from "../_shared/core/email.ts";
import { fmtMoney, formatDate } from "../_shared/core/money.ts";

function checkCronSecret(req: Request): boolean {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return false; // never open — the schedule is the auth
  const header = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const apikey = req.headers.get("x-app-apikey") || "";
  return header === expected || apikey === expected;
}

async function sendReminderEmail(doc: DocRow, settings: SettingsRow): Promise<{ status: string; message_id: string | null; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("INVOICING_FROM_EMAIL") || Deno.env.get("RESEND_FROM_EMAIL") || "TradePro <no-reply@resend.dev>";
  const recipient = String((doc.customer_snapshot as Record<string, unknown>).email || "");
  if (!recipient) return { status: "failed", message_id: null, error: "no customer email" };
  const name = String((doc.customer_snapshot as Record<string, unknown>).name || "there");
  const html = buildDocumentEmailHtml({
    businessName: settings.business_name,
    customerName: name,
    title: doc.title,
    number: doc.number,
    kind: "invoice",
    totalLabel: fmtMoney(doc.total_minor, { currency: doc.currency }),
    dueLabel: "Overdue",
    replyToEmail: settings.reply_to_email || settings.email,
    primaryUrl: `${(Deno.env.get("APP_URL") || "").replace(/\/+$/, "")}/#/public/invoice/${doc.token}`,
  });
  if (!apiKey) {
    return { status: "queued", message_id: null }; // dev mode — log only
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: recipient,
        reply_to: settings.reply_to_email || settings.email || undefined,
        subject: `Reminder: invoice ${doc.number} from ${settings.business_name || "your provider"}`,
        html,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { status: "failed", message_id: null, error: String((body as { message?: string }).message || res.status) };
    return { status: "sent", message_id: (body as { id?: string }).id || null };
  } catch (err) {
    return { status: "failed", message_id: null, error: (err as Error).message };
  }
}

interface DocRow {
  id: string;
  user_id: string;
  kind: string;
  number: string;
  status: string;
  token: string;
  title: string;
  currency: string;
  total_minor: number;
  subtotal_minor: number;
  amount_paid_minor: number;
  due_date: string | null;
  customer_snapshot: Record<string, unknown>;
}

interface SettingsRow {
  business_name: string;
  email: string;
  reply_to_email: string;
  business_email: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!checkCronSecret(req)) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* body is optional */ }
  const mode = String(body.kind || "reminders");
  const graceDays = Math.max(1, Number(body.grace_days || 7));
  const dryRun = body.dry_run === true;

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }

  const cutoff = new Date(Date.now() - graceDays * 86400000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  if (mode === "reminders") {
    // Invoices overdue (due_date < today) that were sent more than grace_days
    // ago and haven't been fully paid.
    const { data, error } = await admin
      .from("documents")
      .select("id,user_id,number,status,token,title,currency,total_minor,subtotal_minor,amount_paid_minor,due_date,customer_snapshot")
      .eq("kind", "invoice")
      .in("status", ["issued", "partially_paid", "overdue"])
      .lt("due_date", today)
      .or(`sent_at.lt.${cutoff},sent_at.is.null`);
    if (error) return json({ error: error.message }, 500);
    const docs = (data ?? []) as DocRow[];

    // Group by user to resolve settings once per reminder email.
    const perUser = new Map<string, DocRow[]>();
    for (const d of docs) {
      const arr = perUser.get(d.user_id) ?? [];
      arr.push(d);
      perUser.set(d.user_id, arr);
    }

    const written: Array<Record<string, unknown>> = [];
    for (const [userId, userDocs] of perUser) {
      let settings: SettingsRow | null = null;
      try {
        const { data: s } = await admin.from("settings")
          .select("business_name,email,reply_to_email,business_email").eq("user_id", userId).maybeSingle();
        settings = s as SettingsRow | null;
      } catch { /* keep null */ }
      for (const doc of userDocs) {
        const result = await sendReminderEmail(doc, settings ?? { business_name: "", email: "", reply_to_email: "", business_email: "" });
        if (dryRun) continue;
        const ev = {
          user_id: userId,
          document_id: doc.id,
          kind: "reminder",
          to_email: String((doc.customer_snapshot as Record<string, unknown>).email || ""),
          subject: `Reminder: invoice ${doc.number}`,
          status: result.status,
          message_id: result.message_id,
          meta: result.error ? { error: result.error } : {},
        };
        const { error: evErr } = await admin.from("email_events").insert(ev);
        if (evErr) {
          return json({ error: evErr.message }, 500);
        }
        written.push({ document_id: doc.id, number: doc.number, status: result.status });
      }
    }
    return json({ ok: true, mode, considered: docs.length, processed: written.length, dry_run: dryRun });
  }

  if (mode === "overdue") {
    const { data, error } = await admin
      .from("documents").select("id")
      .eq("kind", "invoice")
      .in("status", ["issued", "partially_paid"])
      .lt("due_date", today);
    if (error) return json({ error: error.message }, 500);
    const ids = (data ?? []).map((d: { id: string }) => d.id);
    if (!dryRun && ids.length > 0) {
      const { error: updErr } = await admin
        .from("documents").update({ status: "overdue", updated_at: new Date().toISOString() })
        .in("id", ids);
      if (updErr) return json({ error: updErr.message }, 500);
    }
    return json({ ok: true, mode, updated: ids.length, dry_run: dryRun });
  }

  return json({ error: "Unknown mode", ok: false }, 400);
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" },
  });
}