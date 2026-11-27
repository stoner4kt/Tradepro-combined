import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { requireIntegrationSecret, isUuid } from "../_shared/security.ts";
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
function checkIntegrationSecret(req: Request): boolean { return requireIntegrationSecret(req); });