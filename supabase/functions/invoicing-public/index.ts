// invoicing-public — public "share" page for a single quote/invoice token.
// ---------------------------------------------------------------------------
// Serves a self-contained HTML page that lets the recipient view, download or
// print a document WITHOUT any credentials, keyed purely on the unguessable
// `token` (16 random bytes). The page renders client-side from the data baked
// into the HTML (the same renderDocumentHtml used by pdf/view/download), so
// the token holder is the share permission — no WAF/auth needed.
//
// The function resolves the document by its token directly (service-role →
// bypasses RLS), so when a row is later deleted/voided the page 404s.
// ---------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { adminClient } from "../_shared/invoicing/supabase.ts";

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  // Path layout: /functions/v1/invoicing-public/<kind>/<token>
  const parts = new URL(req.url).pathname.split("/").filter(Boolean).slice(3);
  const kind = parts[0];
  const token = parts[1];
  if ((kind !== "quote" && kind !== "invoice") || !token) {
    return html(renderNotFound(kind === "quote" || kind === "invoice" ? "Invalid link" : "Not found"), 404);
  }

  let admin;
  try {
    admin = adminClient();
  } catch {
    return html(renderError("Server configuration error"), 500);
  }

  const { data: doc, error } = await admin
    .from("documents")
    .select("id,user_id,kind,number,status,customer_snapshot,issue_date,due_date,quote_valid_until,title,notes,currency,subtotal_minor,tax_minor,total_minor,amount_paid_minor,created_at,token")
    .eq("token", token)
    .maybeSingle();

  if (error) return html(renderError("Something went wrong"), 500);
  if (!doc) return html(renderNotFound("This document is no longer available"), 404);
  if (doc.kind !== kind || doc.status === "void" || doc.status === "declined") {
    return html(renderNotFound("This document is no longer available"), 404);
  }

  const { data: lines, error: linesError } = await admin
    .from("document_lines")
    .select("description,quantity,unit_price_minor,sort_order")
    .eq("document_id", doc.id)
    .order("sort_order", { ascending: true });
  if (linesError) return html(renderError("Something went wrong"), 500);

  const body = renderShareHtml(doc as unknown as ShareDoc, (lines ?? []) as ShareLine[]);
  return html(body);
});

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

interface ShareDoc {
  kind: string;
  number: string;
  status: string;
  customer_snapshot: Record<string, unknown>;
  issue_date: string | null;
  due_date: string | null;
  quote_valid_until: string | null;
  title: string;
  notes: string;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  amount_paid_minor: number;
}

interface ShareLine {
  description: string;
  quantity: number;
  unit_price_minor: number;
}

function fmtMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format((minor ?? 0) / 100);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function paymentLabel(doc: ShareDoc): string {
  if (doc.kind !== "invoice") return doc.status.replace(/_/g, " ");
  if (doc.status === "paid") return "Paid";
  if (doc.amount_paid_minor > 0 && doc.amount_paid_minor < doc.total_minor) return "Partially paid";
  return doc.status.replace(/_/g, " ");
}

function renderShareHtml(doc: ShareDoc, lines: ShareLine[]): string {
  const name = String(doc.customer_snapshot.name || "Customer");
  const currency = doc.currency || "USD";
  const title = doc.kind === "quote" ? "Quote" : "Invoice";
  const lineRows = lines.length
    ? lines.map((l) => `
      <tr>
        <td>${esc(l.description)}</td>
        <td class="r">${l.quantity}</td>
        <td class="r">${fmtMoney(l.unit_price_minor, currency)}</td>
        <td class="r">${fmtMoney(l.quantity * l.unit_price_minor, currency)}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" class="empty">No line items</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(doc.number)} — ${title}</title>
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
  .toolbar { max-width: 800px; margin: 16px auto; text-align: right; }
  .toolbar button, .toolbar a { display: inline-block; border: 0; background: #2563eb; color: #fff; font-size: 13px; font-weight: 600; padding: 9px 16px; border-radius: 8px; cursor: pointer; text-decoration: none; margin-left: 8px; }
  .empty { color: #94a3b8; text-align: center; padding: 12px 0; }
  @media print { body { background: #fff; } .toolbar { display: none; } .sheet { box-shadow: none; margin: 0; border-radius: 0; padding: 24px; } }
</style>
</head>
<body>
  <div class="toolbar">
    <a href="javascript:window.print()">Print</a>
    <a href="#" id="download">Download</a>
  </div>
  <div class="sheet" id="sheet">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <h1>${title} <span class="muted">${esc(doc.number)}</span></h1>
        <div class="muted" style="margin-top:4px;">${esc(doc.title || "")}</div>
      </div>
      <span class="badge">${esc(paymentLabel(doc))}</span>
    </div>
    <div class="meta">
      <div>
        <div class="muted" style="font-size:12px;">BILL TO</div>
        <div style="font-weight:600;margin-top:2px;">${esc(name)}</div>
        ${doc.quote_valid_until ? `<div class="muted" style="margin-top:6px;">Valid until: <strong>${fmtDate(doc.quote_valid_until)}</strong></div>` : ""}
        ${doc.due_date ? `<div class="muted" style="margin-top:6px;">Due: <strong>${fmtDate(doc.due_date)}</strong></div>` : ""}
      </div>
      <div>
        <div class="muted" style="font-size:12px;text-align:right;">ISSUED</div>
        <div style="margin-top:2px;text-align:right;">${fmtDate(doc.issue_date || "")}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
    <div class="totals">
      <div><span class="muted">Subtotal</span><span>${fmtMoney(doc.subtotal_minor, currency)}</span></div>
      <div><span class="muted">Tax</span><span>${fmtMoney(doc.tax_minor, currency)}</span></div>
      <div class="grand"><span>Total</span><span>${fmtMoney(doc.total_minor, currency)}</span></div>
      ${doc.kind === "invoice" && doc.amount_paid_minor > 0 ? `<div><span class="muted">Paid</span><span>${fmtMoney(doc.amount_paid_minor, currency)}</span></div>` : ""}
      ${doc.kind === "invoice" && doc.amount_paid_minor > 0 && doc.amount_paid_minor < doc.total_minor
        ? `<div><span class="muted">Balance due</span><span>${fmtMoney(doc.total_minor - doc.amount_paid_minor, currency)}</span></div>` : ""}
    </div>
    ${doc.notes ? `<div class="muted" style="margin-top:24px;font-size:13px;">${esc(doc.notes)}</div>` : ""}
    <div class="muted" style="margin-top:32px;font-size:11px;text-align:center;">Generated by TradePro Invoicing</div>
  </div>
  <script>
    document.getElementById('download').addEventListener('click', function (e) {
      e.preventDefault();
      const content = document.getElementById('sheet').outerHTML.replace(/<div class="toolbar">[\\s\\S]*?<\\/div>/, '').replace(/<style>[\\s\\S]*?<\\/style>/, '');
      const htmlDoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.number)}</title></head><body>' + content + '</body></html>';
      const blob = new Blob([htmlDoc], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '${esc(doc.number)}.html';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  </script>
</body>
</html>`;
}

function renderNotFound(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body style="font-family:Arial,sans-serif;background:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="background:#fff;padding:40px;border-radius:12px;text-align:center;max-width:360px;"><h1 style="font-size:22px;margin:0 0 8px;">${esc(message)}</h1><p style="color:#64748b;font-size:14px;margin:0;">The link may be invalid or expired.</p></div></body></html>`;
}

function renderError(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Error</title></head><body style="font-family:Arial,sans-serif;background:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="background:#fff;padding:40px;border-radius:12px;text-align:center;max-width:360px;"><h1 style="font-size:22px;margin:0 0 8px;">${esc(message)}</h1></div></body></html>`;
}