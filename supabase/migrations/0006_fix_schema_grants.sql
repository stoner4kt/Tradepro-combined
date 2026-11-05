-- Fix missing USAGE grants on the invoicing schema.
-- Without this, PostgREST could not address the schema at all,
-- so the service_role key was being treated as anon and every
-- RLS policy on invoicing.* failed with 42501 / 403.
GRANT USAGE ON SCHEMA invoicing TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA invoicing TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA invoicing TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA invoicing TO service_role;


-- Same root cause on the reviewflow schema.
GRANT USAGE ON SCHEMA reviewflow TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA reviewflow TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA reviewflow TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA reviewflow TO service_role;
