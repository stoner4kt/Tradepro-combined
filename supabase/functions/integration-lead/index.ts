import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { CORS, json } from "../_shared/cors.ts";
import { adminClient, checkIntegrationSecret, userIdFromRequest } from "../_shared/supabase.ts";
import { sendReviewForLead } from "../_shared/send-review-email.ts";

/*
 * integration-lead
 * ----------------
 * Admin CRUD + actions on reviewflow.leads, proxied from the combined CRM
 * dashboard. Action is read from the URL path:
 *
 *   POST   /integration-lead          -> create a lead (body = lead fields)
 *   POST   /integration-lead/{id}     -> update a lead (body = fields to patch)
 *   DELETE /integration-lead/{id}     -> delete a lead
 *   POST   /integration-lead/{id}/send-review -> send the review email now
 *
 * Auth: x-integration-secret must match INTEGRATION_SECRET. The owning CRM
 * user is passed via x-user-id; every row access is scoped to that user.
 */

const FIELDS = [
  "first_name", "last_name", "email", "phone", "service", "message",
  "source", "status", "external_id", "completed_at", "review_send_after",
];

function pickFields(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (k in b) out[k] = b[k];
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST" && req.method !== "DELETE") return json({ error: "Method not allowed" }, 405);

  if (!checkIntegrationSecret(req)) return json({ error: "Unauthorized" }, 401);

  const userId = userIdFromRequest(req);
  if (!userId) return json({ error: "x-user-id header is required" }, 400);

  const admin = adminClient();

  const url = new URL(req.url);
  // Path: /functions/v1/integration-lead[/{id}[/send-review]]
  const rel = url.pathname.split("/").filter(Boolean).slice(3);
  const id = rel[0] || null;
  const action = rel[1] || (req.method === "DELETE" ? "delete" : id ? "update" : "create");

  if (action === "send-review") {
    if (!id) return json({ error: "lead id is required" }, 400);
    const result = await sendReviewForLead(admin, id, userId, "manual");
    return json(result.body ?? {}, result.status);
  }

  if (req.method === "DELETE") {
    if (!id) return json({ error: "lead id is required" }, 400);
    const { error } = await admin.from("leads").delete().eq("id", id).eq("user_id", userId);
    if (error) return json({ error: "Failed to delete lead" }, 500);
    return json({ success: true });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  if (action === "create") {
    const patch = pickFields(body);
    const email = String(patch.email || "").toLowerCase().trim();
    if (!email) return json({ error: "email is required" }, 400);
    patch.email = email;
    patch.source = String(patch.source || "manual");
    patch.status = String(patch.status || "new");
    const { data, error } = await admin.from("leads").insert({ ...patch, user_id: userId }).select("*").single();
    if (error) return json({ error: error.message }, 500);
    return json({ lead: data }, 201);
  }

  if (action === "update") {
    if (!id) return json({ error: "lead id is required" }, 400);
    const patch = pickFields(body);
    if ("email" in patch) patch.email = String(patch.email).toLowerCase().trim();
    delete patch.user_id;
    if (Object.keys(patch).length === 0) return json({ error: "No valid fields to update" }, 400);
    const { data, error } = await admin
      .from("leads").update(patch).eq("id", id).eq("user_id", userId).select("*").single();
    if (error) return json({ error: error.message }, 500);
    return json({ lead: data });
  }

  return json({ error: "Unknown action" }, 400);
});