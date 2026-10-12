import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { CORS, json } from "../_shared/cors.ts";
import { adminClient, checkIntegrationSecret, userIdFromRequest } from "../_shared/supabase.ts";

/*
 * integration-overview
 * --------------------
 * Single-call admin snapshot for the combined CRM dashboard. Returns the
 * owning user's ReviewFlow settings row, all their review leads and all their
 * review requests.
 */

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!checkIntegrationSecret(req)) return json({ error: "Unauthorized" }, 401);

  const userId = userIdFromRequest(req);
  if (!userId) return json({ error: "x-user-id header is required" }, 400);

  const admin = adminClient();

  const [settingsRes, leadsRes, reviewsRes] = await Promise.all([
    admin.from("settings").select("*").eq("user_id", userId).maybeSingle(),
    admin.from("leads").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    admin.from("review_requests").select("*").eq("user_id", userId).order("sent_at", { ascending: false }),
  ]);

  // Settings may legitimately be missing when a user just signed up and the
  // seed trigger hasn't completed or was disabled; the dashboard still needs
  // leads + requests, so only hard-fail on the other two.
  if (leadsRes.error) return json({ error: "Failed to load leads" }, 500);
  if (reviewsRes.error) return json({ error: "Failed to load review requests" }, 500);

  return json({
    settings: settingsRes.data,
    leads: leadsRes.data ?? [],
    review_requests: reviewsRes.data ?? [],
  });
});