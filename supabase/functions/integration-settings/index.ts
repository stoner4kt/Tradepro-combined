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
 const url=Deno.env.get("SUPABASE_URL"); const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured as secrets on this function");
 return createClient(url,key,{db:{schema:"reviewflow"}});
}
function checkIntegrationSecret(req: Request): boolean { const expected=Deno.env.get("INTEGRATION_SECRET"); if(!expected)return true; const provided=req.headers.get("x-integration-secret"); return provided!==null && provided===expected; }
function userIdFromRequest(req: Request): string|null { const raw=req.headers.get("x-user-id"); if(!raw)return null; const id=raw.trim(); return id.length>0 && id.length<=64?id:null; }
interface WidgetOwner { user_id:string; widget_api_key:string; auto_send_enabled:boolean; auto_send_delay_hours:number; }
async function resolveWidgetOwner(admin: SupabaseClient,widgetKey:string):Promise<WidgetOwner|null>{const {data,error}=await admin.from("settings").select("user_id, widget_api_key, auto_send_enabled, auto_send_delay_hours").eq("widget_api_key",widgetKey).maybeSingle();if(error||!data)return null;return data as unknown as WidgetOwner;}

/*
 * integration-settings
 * --------------------
 * Read or update the owning user's ReviewFlow settings row from the combined
 * CRM dashboard.
 *
 *   GET  /integration-settings           -> { settings }
 *   POST /integration-settings           -> update the row (body = fields to patch)
 *   POST /integration-settings/rotate-key -> regenerate widget_api_key
 */

const ALLOWED = [
  "business_name", "google_review_url", "review_from_name", "review_from_email",
  "review_reply_to_email", "auto_send_enabled", "auto_send_delay_hours",
  "widget_api_key", "email_subject_template", "email_intro_text",
  "email_button_text", "email_brand_color",
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!checkIntegrationSecret(req)) return json({ error: "Unauthorized" }, 401);

  const userId = userIdFromRequest(req);
  if (!userId) return json({ error: "x-user-id header is required" }, 400);

  const admin = adminClient();

  if (req.method === "GET") {
    const { data: settings, error } = await admin.from("settings").select("*").eq("user_id", userId).maybeSingle();
    if (error) return json({ error: "Failed to load settings" }, 500);
    if (!settings) return json({ error: "Settings row not found — create it via the signup trigger or insert a row" }, 404);
    return json({ settings });
  }

  const url = new URL(req.url);
  // Path: /functions/v1/integration-settings[/rotate-key]
  const rel = url.pathname.split("/").filter(Boolean).slice(3);
  const action = rel[0] || "update";

  if (action === "rotate-key") {
    // Do the rotation inline with the service-role client: the RPC helper
    // relies on auth.uid(), which is NULL on service-role requests.
    const { data: updated, error: updateError } = await admin
      .from("settings")
      .update({ widget_api_key: crypto.randomUUID().replaceAll("-", ""), updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .select("widget_api_key")
      .maybeSingle();
    if (updateError) return json({ error: updateError.message }, 500);
    if (!updated?.widget_api_key) {
      return json({ error: "Settings row not found — cannot rotate a key without settings" }, 500);
    }
    return json({ widget_api_key: updated.widget_api_key });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of Object.keys(body)) if (ALLOWED.includes(k)) patch[k] = body[k];

  if (Object.keys(patch).length === 1) return json({ error: "No valid fields to update" }, 400);

  const { data: existing } = await admin.from("settings").select("id").eq("user_id", userId).maybeSingle();
  if (!existing) {
    const { data: inserted, error: insertError } = await admin
      .from("settings")
      .insert({ user_id: userId, ...patch })
      .select("*")
      .single();
    if (insertError) return json({ error: insertError.message }, 500);
    return json({ settings: inserted });
  }

  const { data: settings, error } = await admin
    .from("settings").update(patch).eq("id", existing.id).eq("user_id", userId).select("*").single();
  if (error) return json({ error: error.message }, 500);
  return json({ settings });
});