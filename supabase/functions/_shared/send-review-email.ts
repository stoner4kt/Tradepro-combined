// Shared "send review email now" logic used by send-review-email and
// integration-lead. Sends through Resend using the owning user's settings,
// logs to reviewflow.review_requests and flips the lead to 'review_sent'.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import { buildEmailHtml, resolveTags, type LeadRow, type SettingsRow } from "./email.ts";

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