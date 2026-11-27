import { httpServerHandler } from 'cloudflare:node';
import { createApp } from './app.js';
import { config } from './utils/config.js';

const app = createApp();
app.listen(3000);
const fetchHandler = httpServerHandler({ port: 3000 });

interface WorkerEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  CRON_SECRET?: string;
  API_ORIGIN?: string;
  INVOICING_URL?: string;
  INVOICING_SECRET?: string;
}

/** Scheduled work is stateless; all claims/limits are persisted in Postgres. */
async function scheduled(controller: ScheduledController, env: WorkerEnv): Promise<void> {
  const supabaseUrl = env.SUPABASE_URL || config.supabase.url;
  const serviceKey = env.SUPABASE_SERVICE_KEY || config.supabase.serviceKey;
  if (controller.cron === '*/5 * * * *') {
    const base=(config.reviewflow.url||supabaseUrl).replace(/\/+$/,'');
    const secret=config.reviewflow.secret;
    if(!base||secret.length<32)throw new Error('ReviewFlow scheduled sender is not configured');
    const response=await fetch(`${base}/functions/v1/integration-send-review`,{method:'POST',headers:{'x-integration-secret':secret,'Content-Type':'application/json'},body:JSON.stringify({mode:'scheduled'})});
    if(!response.ok)throw new Error(`ReviewFlow cron failed: ${response.status}`);
    return;
  }
  if (controller.cron === '*/15 * * * *') {
    const base = (env.INVOICING_URL || config.invoicing.url || supabaseUrl).replace(/\/+$/, '');
    const secret = env.CRON_SECRET || process.env.CRON_SECRET || '';
    if (!base || secret.length < 32) throw new Error('Invoicing cron is not configured');
    const response = await fetch(`${base}/functions/v1/invoicing-cron`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'reminders' }),
    });
    if (!response.ok) throw new Error(`Invoicing reminder cron failed: ${response.status}`);
    const overdue = await fetch(`${base}/functions/v1/invoicing-cron`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'overdue' }),
    });
    if (!overdue.ok) throw new Error(`Invoicing overdue sweep failed: ${overdue.status}`);
    return;
  }
  if (controller.cron === '0 3 * * *') {
    if (!supabaseUrl || !serviceKey) throw new Error('Supabase cleanup is not configured');
    const apiOrigin = (env.API_ORIGIN || config.apiOrigin).replace(/\/+$/, '');
    const cronSecret = env.CRON_SECRET || process.env.CRON_SECRET || '';
    if (!apiOrigin || cronSecret.length < 32) throw new Error('Deep health check is not configured');
    const health = await fetch(`${apiOrigin}/api/health/deep`, { headers: { 'x-cron-secret': cronSecret } });
    if (!health.ok) throw new Error(`Deep health check failed: ${health.status}`);
    const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/cleanup_security_rows`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) throw new Error(`Security cleanup failed: ${response.status}`);
  }
}

export default {
  fetch: fetchHandler,
  scheduled(controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext) {
    ctx.waitUntil(scheduled(controller, env));
  },
};
