-- 0007_security_lockdown.sql
-- Idempotent least-privilege baseline. The application uses service_role only.
DO $$
DECLARE s text; r record;
BEGIN
  FOREACH s IN ARRAY ARRAY['public','reviewflow','invoicing'] LOOP
    IF to_regnamespace(s) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC, anon, authenticated', s);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC, anon, authenticated', s);
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC, anon, authenticated', s);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO service_role', s);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO service_role', s);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO service_role', s);
    IF s IN ('reviewflow','invoicing') THEN
      EXECUTE format('REVOKE USAGE ON SCHEMA %I FROM PUBLIC, anon, authenticated', s);
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO service_role', s);
    END IF;
    -- Existing SECURITY DEFINER and invoker routines receive a deterministic,
    -- schema-qualified search path. No object creation or function body change.
    FOR r IN
      SELECT p.oid::regprocedure AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=s AND p.prokind='f'
    LOOP
      EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, reviewflow, invoicing', r.signature);
    END LOOP;
  END LOOP;
END $$;

-- Future objects created by the migration owner must not become public APIs.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA reviewflow
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA reviewflow
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA reviewflow
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA invoicing
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA invoicing
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA invoicing
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
