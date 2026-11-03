// invoicing-resend-webhook — receives Resend webhook events for invoice emails.
// ---------------------------------------------------------------------------
// Matches the received webhook to an invoicing.email_events row by
// `message_id` (Resend's event.id equals the message id we stored when the
// email was queued/sent), then updates the row's status. Migration 0005's
// mirror trigger propagates the status into public.email_logs automatically.
//
// Auth: x-resend-signature (Resend signs the raw body — see
// https://resend.com/docs/dashboard/webhooks) verified against
// RESEND_WEBHOOK_SECRET. When the secret is unset the webhook is ignored.
// ---------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { adminClient } from "../_shared/invoicing/supabase.ts";

async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!secret) return false; // webhook not configured -> never accept silently
  if (!signature) return false;
  // Resend signs the body HMAC-SHA256 with the webhook secret, base64 encoded
  // in the x-resend-signature header.
  try {
    const key = new TextEncoder().encode(secret);
    const body = new TextEncoder().encode(rawBody);
    const cryptoKey = await crypto.subtle.importKey(
      "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
    );
    const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, body);
  } catch {
    return false;
  }
}

// Map Resend webhook event types to our email_events statuses.
const STATUS_MAP: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.sent": "sent",
  "email.opened": "sent",
  "email.clicked": "sent",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const raw = await req.text();
  if (!raw) return json({ error: "No body" }, 400);
  if (!verifySignature(raw, req.headers.get("x-resend-signature"))) {
    return json({ error: "Invalid signature" }, 401);
  }

  let webhook: { type?: string; data?: { id?: string } };
  try {
    webhook = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const type = webhook.type || "";
  const status = STATUS_MAP[type];
  if (!status) return json({ ok: true, ignored: type }); // unknown event, ack

  const messageId = webhook.data?.id;
  if (!messageId) return json({ error: "No message id in webhook" }, 400);

  let admin;
  try {
    admin = adminClient();
  } catch {
    return json({ error: "Server config error" }, 500);
  }

  const { data: event, error } = await admin
    .from("email_events")
    .select("id,status")
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!event) return json({ ok: true, ignored: "no matching email event" });

  const { error: updErr } = await admin
    .from("email_events")
    .update({ status, meta: { webhook_type: type } })
    .eq("id", event.id);
  if (updErr) return json({ error: updErr.message }, 500);

  return json({ ok: true });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}