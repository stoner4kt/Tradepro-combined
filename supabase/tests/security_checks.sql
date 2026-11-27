-- Run in Supabase SQL Editor after applying migrations 0007 onward.
-- A clean result is zero rows. Any returned row is a security regression.
WITH table_grants AS (
  SELECT 'table privilege' AS issue, table_schema||'.'||table_name AS object_name,
         grantee||':'||privilege_type AS detail
  FROM information_schema.role_table_grants
  WHERE table_schema IN ('public','reviewflow','invoicing')
    AND grantee IN ('PUBLIC','anon','authenticated')
), routine_grants AS (
  SELECT 'routine execute' AS issue, routine_schema||'.'||routine_name AS object_name,
         grantee||':'||privilege_type AS detail
  FROM information_schema.role_routine_grants
  WHERE specific_schema IN ('public','reviewflow','invoicing')
    AND grantee IN ('PUBLIC','anon','authenticated')
), unpinned AS (
  SELECT 'unpinned search_path' AS issue, n.nspname||'.'||p.proname AS object_name,
         pg_get_function_identity_arguments(p.oid) AS detail
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','reviewflow','invoicing')
    AND NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
      WHERE cfg LIKE 'search_path=%'
    )
), rls_disabled AS (
  SELECT 'RLS disabled' AS issue, n.nspname||'.'||c.relname AS object_name,
         'row-level security is not enabled' AS detail
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname IN ('reviewflow','invoicing') OR (n.nspname='public' AND c.relname = ANY(ARRAY['profiles','settings','leads','clients','projects','email_captures','email_logs','auth_tokens','rate_limits','email_opt_outs','email_opt_out_tokens'])))
    AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
), policy_without_uid AS (
  SELECT 'policy missing tenant predicate' AS issue,
         schemaname||'.'||tablename||'.'||policyname AS object_name,
         coalesce(qual,'')||' '||coalesce(with_check,'') AS detail
  FROM pg_policies
  WHERE schemaname IN ('public','reviewflow','invoicing')
    AND ('anon'=ANY(roles) OR 'authenticated'=ANY(roles) OR 'public'=ANY(roles))
    AND (coalesce(qual,'')||' '||coalesce(with_check,'')) !~* 'auth[.]uid'
), bare_uid AS (
  SELECT 'bare auth.uid policy' AS issue, schemaname||'.'||tablename||'.'||policyname AS object_name,
         coalesce(qual,'')||' '||coalesce(with_check,'') AS detail
  FROM pg_policies
  WHERE schemaname IN ('public','reviewflow','invoicing')
    AND (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ 'auth[.]uid[[:space:]]*[(][[:space:]]*[)]'
    AND (coalesce(qual,'')||' '||coalesce(with_check,'')) !~* '[()]?[[:space:]]*select[[:space:]]+auth[.]uid'
)
SELECT * FROM table_grants
UNION ALL SELECT * FROM routine_grants
UNION ALL SELECT * FROM unpinned
UNION ALL SELECT * FROM rls_disabled
UNION ALL SELECT * FROM policy_without_uid
UNION ALL SELECT * FROM bare_uid
ORDER BY issue, object_name, detail;
