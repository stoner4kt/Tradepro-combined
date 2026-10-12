import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { CORS, json } from "../_shared/cors.ts";
import { adminClient, checkIntegrationSecret, userIdFromRequest } from "../_shared/supabase.ts";

/*
 * integration-lookup
 * ------------------
 * Called by the CRM Worker to render the review-status badge next to a
 * contact. Returns every ReviewFlow lead matching the given email for the
 * owning user, shaped as the CRM reviewFlowService expects:
 *
 *   { leads: [{ id, first_name, last_name, email, service, status,
 *               created_at, completed_at, review_send_after }], matched_at }
 */

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!checkIntegrationSecret(req)) return json({ error: "Unauthorized" }, 401);

  const userId = userIdFromRequest(req);
  if (!userId) return json({ error: "x-user-id header is required" }, 400);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const email = String(body.email || "").toLowerCase().trim();
  if (!email) return json({ error: "email is required" }, 400);

  const admin = adminClient();
  const { data: leads, error } = await admin
    .from("leads")
    .select("id, first_name, last_name, email, service, status, created_at, completed_at, review_send_after")
    .eq("email", email)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return json({ error: "Failed to query leads" }, 500);

  return json({
    leads: leads ?? [],
    matched_at: leads && leads.length ? leads[0].created_at : null,
  });
});