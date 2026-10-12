import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { CORS, json } from "../_shared/cors.ts";
import { adminClient, checkIntegrationSecret, userIdFromRequest } from "../_shared/supabase.ts";
import { sendReviewForLead } from "../_shared/send-review-email.ts";

/*
 * send-review-email
 * -----------------
 * Sends the review-request email for a lead and logs it to
 * review_requests. Used by the combined dashboard (manual "Send now" clicks)
 * and by the frontend auto-send scheduler.
 *
 * Auth:
 *   - x-integration-secret must match INTEGRATION_SECRET when called through
 *     the CRM Worker proxy (the Worker always adds it).
 *   - The owning user is passed via x-user-id.
 *
 * Semantics are identical to integration-lead/{id}/send-review, but exposed
 * as its own function so a standalone client can call it directly.
 */

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!checkIntegrationSecret(req)) return json({ error: "Unauthorized" }, 401);

  const userId = userIdFromRequest(req);
  if (!userId) return json({ error: "x-user-id header is required" }, 400);

  const admin = adminClient();

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const leadId = String(body.lead_id || "");
  if (!leadId) return json({ error: "lead_id is required" }, 400);

  const result = await sendReviewForLead(admin, leadId, userId, "manual");
  return json(result.body ?? {}, result.status);
});