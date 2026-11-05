// Collision-free re-export of the shared Invoicing CORS helpers.
// The merged repo's `_shared/cors.ts` belongs to ReviewFlow; the standalone
// Invoicing-system repo imported `_shared/cors` directly. This module lets
// functions keep that import style without touching ReviewFlow's file.
export * from "../core/cors.ts";