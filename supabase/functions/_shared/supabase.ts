// Shared Supabase admin client + helpers for ReviewFlow edge functions.
//
// Secrets are configured per function with `supabase secrets set`:
//   SUPABASE_URL            (project URL, e.g. https://<ref>.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY
//   INTEGRATION_SECRET      (shared with the CRM Worker's REVIEWFLOW_SECRET)
//
// The merged system is multi-tenant: every ReviewFlow row belongs to a CRM
// user via `user_id`. The CRM Worker proxies all admin calls and passes the
// owning user in the `x-user-id` header. Widget / capture entries resolve the
// owner through the widget API key instead.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured as secrets on this function");
  }
  // Reviews data lives in the `reviewflow` schema (see migration 0003); without
  // this every .from() would silently hit the CRM tables in `public`.
  return createClient(url, key, { db: { schema: "reviewflow" } });
}

/** Verifies the x-integration-secret against INTEGRATION_SECRET. */
export function checkIntegrationSecret(req: Request): boolean {
  const expected = Deno.env.get("INTEGRATION_SECRET");
  if (!expected) return true; // not set → open (dev) — set it in production
  const provided = req.headers.get("x-integration-secret");
  return provided !== null && provided === expected;
}

/** Pulls the owning CRM user id from the x-user-id header (set by the Worker). */
export function userIdFromRequest(req: Request): string | null {
  const raw = req.headers.get("x-user-id");
  if (!raw) return null;
  const id = raw.trim();
  return id.length > 0 && id.length <= 64 ? id : null;
}

export interface WidgetOwner {
  user_id: string;
  widget_api_key: string;
  auto_send_enabled: boolean;
  auto_send_delay_hours: number;
}

/** Resolves the owning CRM user from a widget API key. */
export async function resolveWidgetOwner(admin: SupabaseClient, widgetKey: string): Promise<WidgetOwner | null> {
  const { data, error } = await admin
    .from("settings")
    .select("user_id, widget_api_key, auto_send_enabled, auto_send_delay_hours")
    .eq("widget_api_key", widgetKey)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as WidgetOwner;
}