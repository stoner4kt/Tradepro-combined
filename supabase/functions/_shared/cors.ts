// Shared CORS helpers for all ReviewFlow edge functions.
// Widget-facing functions allow all origins; integration functions (called
// server-to-server from the CRM Worker) are CORS-permissive too so the CRM
// can proxy them from any origin.

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