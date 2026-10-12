import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { CORS, json } from "../_shared/cors.ts";
import { adminClient, checkIntegrationSecret, userIdFromRequest } from "../_shared/supabase.ts";

/*
 * integration-capture
 * -------------------
 * Called by the CRM Worker when a lead is marked won or a project is
 * completed. Mirrors the CRM record into reviewflow.leads so the combined
 * dashboard + review pipeline can act on it.
 *
 * Auth: x-integration-secret must match INTEGRATION_SECRET (the same value
 * the Worker sends as its REVIEWFLOW_SECRET). The owning CRM user is passed
 * via x-user-id.
 *
 * Idempotent: upserts by external_id (the CRM project id) and falls back to
 * matching by email — scoped to the owning user.
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

  const email = String(body.email || "").toLowerCase().trim();
  if (!email) return json({ error: "email is required" }, 400);

  const externalId = body.external_id ? String(body.external_id).trim() : null;

  const payload = {
    first_name: String(body.first_name || ""),
    last_name: String(body.last_name || ""),
    email,
    phone: body.phone ? String(body.phone) : null,
    service: body.service ? String(body.service) : null,
    message: body.message ? String(body.message) : null,
    source: "crm",
    status: "new",
    updated_at: new Date().toISOString(),
  };

  let existing: { id: string } | null = null;
  if (externalId) {
    const { data: byExt, error: extError } = await admin
      .from("leads").select("id").eq("external_id", externalId).eq("user_id", userId).maybeSingle();
    if (extError) return json({ error: "Failed to query leads" }, 500);
    existing = (byExt as { id: string } | null) ?? null;
  }
  if (!existing) {
    const { data: byEmail, error: emailError } = await admin
      .from("leads").select("id").eq("email", email).eq("user_id", userId).maybeSingle();
    if (emailError) return json({ error: "Failed to query leads" }, 500);
    existing = (byEmail as { id: string } | null) ?? null;
  }

  if (existing?.id) {
    const { error: updateError } = await admin
      .from("leads")
      .update({ ...payload, external_id: externalId ?? null })
      .eq("id", existing.id);
    if (updateError) return json({ error: "Failed to update lead" }, 500);
    return json({ success: true, lead_id: existing.id, created: false });
  }

  const { data: inserted, error: insertError } = await admin
    .from("leads")
    .insert({ ...payload, external_id: externalId ?? null, user_id: userId })
    .select("id")
    .single();
  if (insertError) return json({ error: "Failed to save lead" }, 500);

  return json({ success: true, lead_id: inserted.id, created: true }, 201);
});