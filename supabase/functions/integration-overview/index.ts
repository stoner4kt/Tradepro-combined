import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-widget-key, x-integration-secret, x-internal-call, x-user-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, PATCH, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!checkIntegrationSecret(req)) return json({ error: "Unauthorized" }, 401);

  const userId = userIdFromRequest(req);
  if (!userId) return json({ error: "x-user-id header is required" }, 400);

  try {
    const admin = adminClient();
    const [settingsRes, leadsRes, reviewsRes] = await Promise.all([
      admin.from("settings").select("*").eq("user_id", userId).maybeSingle(),
      admin.from("leads").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      admin.from("review_requests").select("*").eq("user_id", userId).order("sent_at", { ascending: false }),
    ]);

    if (leadsRes.error) return json({ error: "Failed to load leads", detail: leadsRes.error.message }, 500);
    if (reviewsRes.error) return json({ error: "Failed to load review requests", detail: reviewsRes.error.message }, 500);

    return json({
      settings: settingsRes.data,
      leads: leadsRes.data ?? [],
      review_requests: reviewsRes.data ?? [],
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
