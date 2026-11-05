// Shared CORS + JSON helpers for the Invoicing edge functions.
//
// This lives in `_shared/core/` because the merged repo's `_shared/` already
// has a `cors.ts` owned by ReviewFlow. `_shared/invoicing/cors.ts` re-exports
// this module under a collision-free name so `invoicing-public` and
// `invoicing-cron` can keep the standalone import style (`_shared/cors`).

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-api-key, x-integration-secret, x-internal-call, x-user-id, x-widget-key, x-app-apikey",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function methodNotAllowed(): Response {
  return json({ error: "Method not allowed" }, 405);
}