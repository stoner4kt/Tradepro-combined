#!/usr/bin/env bash
set -euo pipefail
if ! command -v supabase >/dev/null 2>&1; then echo "Supabase CLI is required; install it and link the project first." >&2; exit 1; fi
[[ -d supabase/functions ]] || { echo "Run from repository root." >&2; exit 1; }
for directory in supabase/functions/*; do
  [[ -d "$directory" && -f "$directory/index.ts" ]] || continue
  function_name="$(basename "$directory")"
  [[ "$function_name" == _shared ]] && continue
  echo "Deploying $function_name with JWT gateway verification disabled..."
  supabase functions deploy "$function_name" --no-verify-jwt
done
echo "Deployment complete. Verify function-level auth and secrets in staging."
