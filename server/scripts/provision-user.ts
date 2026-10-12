/**
 * Provision a user (email + password) in the SINGLE merged Supabase project.
 * One login now reaches the entire system (CRM + Reviews), so a single
 * auth.admin.createUser() call is enough — the signup trigger seeds the
 * profile, CRM settings and ReviewFlow settings rows automatically.
 *
 * Usage (also see the README):  cd server && npx tsx scripts/provision-user.ts
 * with these env vars:
 *   SUPABASE_URL + SUPABASE_SERVICE_KEY   (the merged Supabase project)
 *   PROVISION_EMAIL + PROVISION_PASSWORD  (the login to create)
 *
 * Secrets flow via env vars only — nothing is stored in code or git.
 */

import { createClient } from '@supabase/supabase-js';

async function main(): Promise<void> {
  const url = (process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  const email = (process.env.PROVISION_EMAIL || '').trim();
  const password = process.env.PROVISION_PASSWORD || '';

  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_KEY');
  if (!email) missing.push('PROVISION_EMAIL');
  if (!password) missing.push('PROVISION_PASSWORD');
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    if (error.code === 'user_already_exists') {
      console.warn(`User already exists — skipped (${email})`);
      return;
    }
    throw new Error(error.message);
  }
  console.log(`Created user: ${data.user?.email} (${data.user?.id})`);
  console.log('This single login reaches the CRM dashboard AND the Reviews dashboard.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});