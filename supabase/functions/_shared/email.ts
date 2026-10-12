// Shared email template + merge-tag logic for the ReviewFlow edge functions.
// This mirrors the previous client-side emailTemplate.ts, but lives server-side
// so dashboard previews and the real sent emails always match and the widget
// bundle stays dependency-free.

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