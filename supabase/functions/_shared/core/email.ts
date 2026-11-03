// Shared email HTML builders for the Invoicing edge functions.
// Used by invoicing-api (quote/invoice email send). Templates are kept
// dependency-free and match the brand of the merged dashboard.

export interface DocumentEmailProps {
  businessName: string;
  customerName: string;
  title: string;
  number: string;
  kind: "quote" | "invoice";
  totalLabel: string;
  dueLabel: string;
  replyToEmail: string;
  primaryUrl: string; // the share/SPA link or payment instructions target
}

export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildDocumentEmailHtml(props: DocumentEmailProps): string {
  const {
    businessName, customerName, title, number, kind, totalLabel, dueLabel, replyToEmail, primaryUrl,
  } = props;
  const name = escapeHtml(businessName || "");
  const recipient = escapeHtml(customerName || "there");
  const safeTitle = escapeHtml(title || (kind === "quote" ? "Quote" : "Invoice"));
  const safeNumber = escapeHtml(number);
  const safeTotal = escapeHtml(totalLabel);
  const safeDue = escapeHtml(dueLabel);
  const safeUrl = escapeHtml(primaryUrl || "#");
  const heading = kind === "quote" ? "Your quote is ready" : "Invoice ready";
  const buttonLabel = kind === "quote" ? "View quote" : "View invoice";

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f1f5f9;">
    <div style="padding:32px 24px;background-color:#f1f5f9;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
        <div style="background:#0f172a;padding:24px 28px;">
          <div style="font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">${heading}</div>
          ${name ? `<div style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin-top:2px;">${name}</div>` : ""}
        </div>
        <div style="padding:28px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;margin:0 0 16px 0;">
            Hi ${recipient},
          </p>
          <p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#475569;margin:0 0 20px 0;">
            ${kind === "quote" ? "Thanks for your interest. Here is the quote we put together for you." : "Thanks for choosing us. Your invoice is ready to view and pay."}
          </p>
          <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 20px 0;">
            <tr>
              <td style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;padding:8px 0;">Document</td>
              <td style="font-family:Arial,sans-serif;font-size:13px;color:#0f172a;padding:8px 0;text-align:right;">${safeTitle} · ${safeNumber}</td>
            </tr>
            <tr>
              <td style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;padding:8px 0;">Amount</td>
              <td style="font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#0f172a;padding:8px 0;text-align:right;">${safeTotal}</td>
            </tr>
            <tr>
              <td style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;padding:8px 0;">${kind === "quote" ? "Valid until" : "Due"}</td>
              <td style="font-family:Arial,sans-serif;font-size:13px;color:#0f172a;padding:8px 0;text-align:right;">${safeDue}</td>
            </tr>
          </table>
          <div style="text-align:center;margin:24px 0;">
            <a href="${safeUrl}" target="_blank" rel="noopener"
               style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;padding:13px 30px;border-radius:8px;">
              ${buttonLabel}
            </a>
          </div>
          <p style="font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-align:center;margin:8px 0 0 0;">
            Questions? Reply to ${escapeHtml(replyToEmail || "this email")}
          </p>
        </div>
        <div style="text-align:center;padding:16px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;margin:0;">
            Sent by ${name || "this business"} · Powered by TradePro Invoicing
          </p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}