import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { CORS, json } from "../_shared/cors.ts";
import { adminClient, checkIntegrationSecret, userIdFromRequest } from "../_shared/supabase.ts";
import { sendReviewForLead } from "../_shared/send-review-email.ts";

/*
 * integration-send-review
 * -----------------------
 * Called by the CRM Worker when a project flips to completed and auto-send is
 * on. Locates the ReviewFlow lead by external_id (CRM project id) or email —
 * scoped to the owning user — then sends the review email.
 *
 * Body: { email: string, external_id?: string }
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
  const externalId = body.external_id ? String(body.external_id).trim() : null;
  if (!email && !externalId) return json({ error: "email or external_id is required" }, 400);

  const admin = adminClient();

  let query = admin.from("leads").select("*").eq("email", email).eq("user_id", userId).limit(1);
  if (externalId) query = admin.from("leads").select("*").eq("external_id", externalId).eq("user_id", userId).limit(1);

  const { data: leads, error: leadError } = await query;
  const lead = leads?.[0];
  if (leadError || !lead) return json({ error: "Lead not found" }, 404);

  const result = await sendReviewForLead(admin, lead.id, userId, "auto");
  return json(result.body ?? {}, result.status);
});