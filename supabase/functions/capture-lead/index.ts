import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
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
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

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

/*
 * capture-lead
 * ------------
 * Public widget endpoint. Authenticates with the widget API key
 * (x-widget-key header), resolves the owning CRM user through that key, and
 * inserts the lead under that user in reviewflow.leads.
 *
 * Multi-tenant: rows are always scoped to the resolved owner's user_id.
 */

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const widgetKey = req.headers.get("x-widget-key");
  if (!widgetKey) return json({ error: "x-widget-key header is required" }, 401);

  const admin = adminClient();
  const owner = await resolveWidgetOwner(admin, widgetKey);
  if (!owner) return json({ error: "Invalid API key" }, 401);

  let body: Record<string, string>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  if (!body.email) return json({ error: "email is required" }, 400);

  const { data: lead, error } = await admin.from("leads").insert({
    user_id:    owner.user_id,
    first_name: body.first_name || "",
    last_name:  body.last_name  || "",
    email:      body.email.toLowerCase().trim(),
    phone:      body.phone   || null,
    service:    body.service || null,
    message:    body.message || null,
    source:     "widget",
    status:     "new",
  }).select("id").single();

  if (error) return json({ error: "Failed to save lead" }, 500);

  return json({ success: true, lead_id: lead.id }, 201);
});