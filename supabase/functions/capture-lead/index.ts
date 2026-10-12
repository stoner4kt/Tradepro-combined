import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { CORS, json } from "../_shared/cors.ts";
import { adminClient, resolveWidgetOwner } from "../_shared/supabase.ts";

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