-- 0009_auth_support.sql
-- Durable auth tokens, Postgres rate limits, opt-outs and widget consent metadata.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS allowed_origins text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS daily_email_cap integer NOT NULL DEFAULT 50;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS consent_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS consent_text text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE reviewflow.leads ADD COLUMN IF NOT EXISTS consent_at timestamptz;
ALTER TABLE reviewflow.leads ADD COLUMN IF NOT EXISTS consent_text text;
ALTER TABLE reviewflow.leads ADD COLUMN IF NOT EXISTS source_url text;

CREATE TABLE IF NOT EXISTS public.auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('email_verify','password_reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_idx ON public.auth_tokens(user_id,purpose,created_at DESC);
ALTER TABLE public.auth_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.auth_tokens TO service_role;

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text,p_window_seconds integer,p_max integer)
RETURNS TABLE(allowed boolean,remaining integer,retry_after integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_start timestamptz; v_count integer; v_now timestamptz := clock_timestamp();
BEGIN
  IF p_key IS NULL OR length(p_key) > 512 OR p_window_seconds < 1 OR p_max < 1 THEN
    RAISE EXCEPTION 'invalid rate limit parameters';
  END IF;
  INSERT INTO public.rate_limits(key,window_start,count,updated_at)
  VALUES(p_key,v_now,1,v_now)
  ON CONFLICT(key) DO UPDATE SET
    window_start = CASE WHEN public.rate_limits.window_start + make_interval(secs => p_window_seconds) <= v_now THEN v_now ELSE public.rate_limits.window_start END,
    count = CASE WHEN public.rate_limits.window_start + make_interval(secs => p_window_seconds) <= v_now THEN 1 ELSE public.rate_limits.count + 1 END,
    updated_at = v_now
  RETURNING public.rate_limits.window_start,public.rate_limits.count INTO v_start,v_count;
  RETURN QUERY SELECT v_count <= p_max, greatest(0,p_max-v_count),
    greatest(0,ceil(extract(epoch FROM (v_start + make_interval(secs => p_window_seconds) - v_now)))::integer);
END $$;
REVOKE ALL ON FUNCTION public.rate_limit_hit(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_security_rows()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.rate_limits WHERE updated_at < now() - interval '1 day';
  DELETE FROM public.auth_tokens WHERE expires_at < now() - interval '2 days' OR used_at < now() - interval '2 days';
END $$;
REVOKE ALL ON FUNCTION public.cleanup_security_rows() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_security_rows() TO service_role;

CREATE TABLE IF NOT EXISTS public.email_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_opt_outs_owner_email_idx ON public.email_opt_outs(user_id,lower(email));
ALTER TABLE public.email_opt_outs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_opt_outs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.email_opt_outs TO service_role;
