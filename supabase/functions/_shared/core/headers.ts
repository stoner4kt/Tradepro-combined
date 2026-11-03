// Standard response headers shared by all Invoicing edge functions.
// Deliberately referenced through a tiny function (called once per request)
// so functions have near-identical bodies whether they inline headers or
// import them.

export function standardHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}