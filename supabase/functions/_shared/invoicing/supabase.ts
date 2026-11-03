// Collision-free re-export of the shared Invoicing supabase helpers.
// Same rationale as `_shared/invoicing/cors.ts`: keeps the standalone
// `_shared/supabase.ts` import style working in the merged repo.
export * from "../core/supabase.ts";