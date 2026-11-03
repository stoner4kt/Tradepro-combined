// Shared Supabase admin client for the Invoicing edge functions.
//
// In the merged Tradepro-combined deploy the invoicing data lives in the
// `invoicing` schema on the SAME Supabase project as the CRM (public.*) and
// ReviewFlow (reviewflow.*). The service-role client therefore MUST target
// `{ db: { schema: "invoicing" } }` — without it every .from() would silently
// hit the CRM tables in `public`.
//
// Secrets (Supabase Edge Functions dashboard → function secrets):
//   SUPABASE_URL               project URL
//   SUPABASE_SERVICE_ROLE_KEY  service-role key
//   INTEGRATION_SECRET         shared with the CRM Worker's INVOICING_SECRET
//                              (the invoicing-api function requires it)
//   X_API_KEY                  shared with the CRM Worker's SV_API_KEY
//                              (the invoicing-api function uses it as a second
//                              factor for the "active" true share endpoints)
//   CRON_SECRET                monthly/run scheduler secret
//   RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_FROM_NAME, RESEND_REPLY_TO
//   APP_URL                    e.g. https://<client>.com — used to build
//                              public document share links
//   REMINDER_RUN_KEY           optional: secrets for additive workloads
//   INVOICING_FROM_EMAIL       optional: overrides RESEND_FROM_EMAIL for
//                              invoice-related mail

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured as secrets on this function");
  }
  // Invoicing data lives in the `invoicing` schema (see migration 0004).
  // Typed to the default schema so any `SupabaseClient` contextual type works.
  return createClient(url, key, { db: { schema: "invoicing" } }) as unknown as SupabaseClient;
}

/**
 * Verifies the x-integration-secret header against INTEGRATION_SECRET.
 * When INTEGRATION_SECRET is unset the check is skipped (local dev) — set it
 * in production exactly like the ReviewFlow integration functions.
 */
export function checkIntegrationSecret(req: Request): boolean {
  const expected = Deno.env.get("INTEGRATION_SECRET");
  if (!expected) return true;
  const provided = req.headers.get("x-integration-secret");
  return provided !== null && provided === expected;
}

/**
 * Verifies the x-api-key header against X_API_KEY. This is the second factor
 * used by the "active" true share endpoints (pdf/view/download): the Worker
 * always sends both secrets, so a client that somehow knows the integration
 * secret alone still cannot pull documents.
 */
export function checkXApiKey(req: Request): boolean {
  const expected = Deno.env.get("X_API_KEY");
  if (!expected) return true;
  const provided = req.headers.get("x-api-key");
  return provided !== null && provided === expected;
}

/** Pulls the owning CRM user id from the x-user-id header (set by the Worker). */
export function userIdFromRequest(req: Request): string | null {
  const raw = req.headers.get("x-user-id");
  if (!raw) return null;
  const id = raw.trim();
  return id.length > 0 && id.length <= 64 ? id : null;
}