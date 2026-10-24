import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-widget-key, x-integration-secret, x-internal-call, x-user-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, PATCH, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}


function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured as secrets on this function");
  return createClient(url, key, { db: { schema: "reviewflow" } });
}

function checkIntegrationSecret(req: Request): boolean {
  const expected = Deno.env.get("INTEGRATION_SECRET");
  if (!expected) return true;
  const provided = req.headers.get("x-integration-secret");
  return provided !== null && provided === expected;
}

function userIdFromRequest(req: Request): string | null {
  const raw = req.headers.get("x-user-id");
  if (!raw) return null;
  const id = raw.trim();
  return id.length > 0 && id.length <= 64 ? id : null;
}

interface WidgetOwner {
  user_id: string;
  widget_api_key: string;
  auto_send_enabled: boolean;
  auto_send_delay_hours: number;
}

async function resolveWidgetOwner(admin: SupabaseClient, widgetKey: string): Promise<WidgetOwner | null> {
  const { data, error } = await admin.from("settings")
    .select("user_id, widget_api_key, auto_send_enabled, auto_send_delay_hours")
    .eq("widget_api_key", widgetKey).maybeSingle();
  if (error || !data) return null;
  return data as unknown as WidgetOwner;
}


export interface EmailTemplateData {
  businessName: string;
  firstName: string;
  introText: string;
  buttonText: string;
  reviewUrl: string;
  brandColor: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildEmailHtml(data: EmailTemplateData): string {
  const { businessName, firstName, introText, buttonText, reviewUrl, brandColor } = data;
  const name = escapeHtml(businessName || "");
  const safeIntro = escapeHtml(introText || "");
  const safeButton = escapeHtml(buttonText || "Leave a Google Review");
  const safeUrl = escapeHtml(reviewUrl || "#");
  const color = brandColor && /^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : "#0ea5e9";
  const background = "linear-gradient(135deg,#0b0f19 0%,#0d1629 50%,#1a2234 100%)";

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#0b0f19;">
    <div style="background:${background};padding:32px 24px;">
      <div style="max-width:560px;margin:0 auto;">
        <div style="text-align:center;padding-bottom:20px;border-bottom:1px solid #1a2234;">
          <div style="font-family:Arial,sans-serif;font-size:24px;font-weight:bold;color:#ffffff;">ReviewFlow</div>
          ${name ? `<div style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin-top:4px;">${name}</div>` : ""}
        </div>
        <div style="padding:28px 8px 8px 8px;">
          <p style="font-family:Arial,sans-serif;font-size:16px;color:#e2e8f0;margin:0 0 12px 0;">
            Hi ${escapeHtml(firstName || "there")},
          </p>
          <p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#94a3b8;margin:0 0 24px 0;">
            ${safeIntro}
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${safeUrl}" target="_blank" rel="noopener"
               style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:8px;">
              ${safeButton}
            </a>
          </div>
          <p style="font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-align:center;margin:8px 0 0 0;">
            Takes 60 seconds
          </p>
        </div>
        <div style="text-align:center;padding-top:20px;margin-top:20px;border-top:1px solid #1a2234;">
          <p style="font-family:Arial,sans-serif;font-size:11px;color:#64748b;margin:0;">
            Sent by ${name || "this business"} · Powered by ReviewFlow by Conextsol
          </p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export interface LeadRow {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  service: string | null;
  message: string | null;
  source: string;
  status: string;
  external_id: string | null;
  completed_at: string | null;
  review_send_after: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettingsRow {
  id: string;
  user_id: string;
  business_name: string;
  google_review_url: string;
  review_from_name: string;
  review_from_email: string;
  review_reply_to_email: string;
  auto_send_enabled: boolean;
  auto_send_delay_hours: number;
  widget_api_key: string;
  email_subject_template: string;
  email_intro_text: string;
  email_button_text: string;
  email_brand_color: string;
  created_at: string;
  updated_at: string;
}

export function resolveTags(value: string, lead: Partial<LeadRow>, settings: Partial<SettingsRow>): string {
  const businessName = String(settings.business_name || "");
  const firstName = String(lead.first_name || "");
  const service = String(lead.service || "your recent service");
  return value
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{business_name\}\}/g, businessName)
    .replace(/\{\{service\}\}/g, service);
}

export async function sendReviewForLead(
  admin: SupabaseClient,
  leadId: string,
  userId: string,
  trigger: "auto" | "manual",
): Promise<{ ok: boolean; status: number; body?: Record<string, unknown> }> {
  const { data: lead, error: leadError } = await admin
    .from("leads").select("*").eq("id", leadId).eq("user_id", userId).maybeSingle();
  if (leadError || !lead) return { ok: false, status: 404, body: { error: "Lead not found" } };

  const { data: settings } = await admin.from("settings").select("*").eq("user_id", userId).single();
  if (!settings) return { ok: false, status: 500, body: { error: "Settings not configured" } };
  const s = settings as unknown as SettingsRow;
  const leadRow = lead as unknown as LeadRow;

  const subject = resolveTags(String(s.email_subject_template || ""), leadRow, s);
  const intro = resolveTags(String(s.email_intro_text || ""), leadRow, s);
  const html = buildEmailHtml({
    businessName: s.business_name,
    firstName: leadRow.first_name,
    introText: intro,
    buttonText: s.email_button_text,
    reviewUrl: s.google_review_url,
    brandColor: s.email_brand_color,
  });

  const fromEmail = String(s.review_from_email || "");
  if (!fromEmail) {
    return { ok: false, status: 400, body: { error: "review_from_email is not configured. Verify a sender domain in Resend first." } };
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) return { ok: false, status: 500, body: { error: "RESEND_API_KEY is not configured" } };

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: s.review_from_name ? `${s.review_from_name} <${fromEmail}>` : fromEmail,
      to: [leadRow.email],
      reply_to: s.review_reply_to_email || undefined,
      subject,
      html,
    }),
  });
  const resendData = await resendRes.json().catch(() => ({}));
  if (!resendRes.ok) {
    return { ok: false, status: 502, body: { error: "Resend send failed", detail: resendData } };
  }

  const recipient = `${leadRow.first_name || ""} ${leadRow.last_name || ""}`.trim() || undefined;
  await admin.from("review_requests").insert({
    user_id:           userId,
    lead_id:           leadRow.id,
    recipient_email:   leadRow.email,
    recipient_name:    recipient,
    email_subject:     subject,
    resend_message_id: (resendData as { id?: string }).id,
    status:            "sent",
    triggered_by:      trigger,
  });

  await admin.from("leads").update({
    status:     "review_sent",
    updated_at: new Date().toISOString(),
  }).eq("id", leadRow.id);

  return { ok: true, status: 200, body: { success: true, message_id: (resendData as { id?: string }).id } };
}

/*
 * integration-send-review
 * -----------------------
 * Called by the CRM Worker when a project flips to completed and auto-send is
 * on. Locates the ReviewFlow lead by external_id (CRM project id) or email —
 * scoped to the owning user — then sends the review email.
 *
 * Body: { email: string, external_id?: string }
 */

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!checkIntegrationSecret(req)) return json({ error: "Unauthorized" }, 401);

  const userId = userIdFromRequest(req);
  if (!userId) return json({ error: "x-user-id header is required" }, 400);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const email = String(body.email || "").toLowerCase().trim();
  const externalId = body.external_id ? String(body.external_id).trim() : null;
  if (!email && !externalId) return json({ error: "email or external_id is required" }, 400);

  const admin = adminClient();

  let query = admin.from("leads").select("*").eq("email", email).eq("user_id", userId).limit(1);
  if (externalId) query = admin.from("leads").select("*").eq("external_id", externalId).eq("user_id", userId).limit(1);

  const { data: leads, error: leadError } = await query;
  const lead = leads?.[0];
  if (leadError || !lead) return json({ error: "Lead not found" }, 404);

  const result = await sendReviewForLead(admin, lead.id, userId, "auto");
  return json(result.body ?? {}, result.status);
});