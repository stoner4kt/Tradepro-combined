import express from 'express';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { config, productionConfigErrors } from './utils/config.js';
import { logger } from './utils/logger.js';
import { createFreshStore } from './store/index.js';
import type { Store } from './store/Store.js';
import { AuthService } from './services/authService.js';
import { authServiceMiddleware } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { leadsRoutes } from './routes/leads.js';
import { clientsRoutes } from './routes/clients.js';
import { projectsRoutes } from './routes/projects.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { settingsRoutes } from './routes/settings.js';
import { capturesRoutes } from './routes/captures.js';
import { integrationRoutes } from './routes/integration.js';
import { invoicingRoutes } from './routes/invoicing.js';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  const startupErrors = productionConfigErrors();
  if (startupErrors.length) {
    logger.error('Production configuration invalid', { errors: startupErrors });
    app.use((_req, res) => res.status(503).json({ error: { message: 'Service temporarily unavailable' } }));
    return app;
  }
  app.use(cors({ origin: config.corsOrigin || false, credentials: true, optionsSuccessStatus: 204, exposedHeaders: ['Retry-After'] }));
  app.use((req, res, next) => {
    if (config.nodeEnv === 'test' || ['GET','HEAD','OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin') || (req.get('referer') ? new URL(req.get('referer')!).origin : '');
    if (!config.appOrigin || origin !== config.appOrigin || req.get('content-type')?.split(';')[0] !== 'application/json' || req.get('x-tradepro') !== '1') return res.status(403).json({ error: { message: 'Request origin validation failed' } });
    next();
  });
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.path.startsWith('/api')) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  const uuidParams = ['id', 'leadId', 'clientId', 'projectId', 'documentId', 'paymentId'];
  for (const param of uuidParams) {
    app.param(param, (req, res, next, value) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        res.status(400).json({ error: { message: 'Invalid resource identifier' } });
        return;
      }
      next();
    });
  }

  // Health
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  });

  app.get('/api/health/deep', async (req, res) => {
    const expected = process.env.CRON_SECRET || '';
    const supplied = req.get('x-cron-secret') || '';
    if (expected.length < 32 || expected.length !== supplied.length) {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
    if (mismatch !== 0) return res.status(401).json({ error: { message: 'Unauthorized' } });
    if (!config.supabase.configured) return res.status(503).json({ error: { message: 'Health check unavailable' } });
    try {
      const supabase = createClient(config.supabase.url, config.supabase.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error } = await supabase.from('profiles').select('id').limit(1);
      if (error) throw error;
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true });
    } catch (err) {
      logger.warn('Deep health check failed', { error: (err as Error).message });
      return res.status(503).json({ error: { message: 'Health check unavailable' } });
    }
  });

  // Single store instance shared by auth + all resource routes.
  const store: Store = createFreshStore();
  const authService = new AuthService(store);
  app.use(authServiceMiddleware(authService));

  app.use('/api/auth', authRoutes(authService));
  app.use('/api/leads', leadsRoutes(store));
  app.use('/api/clients', clientsRoutes(store));
  app.use('/api/projects', projectsRoutes(store));
  app.use('/api/dashboard', dashboardRoutes(store));
  app.use('/api/settings', settingsRoutes(store));
  app.use('/api/capture', capturesRoutes(store));
  app.use('/api/captures', capturesRoutes(store));
  app.use('/api/integration', integrationRoutes(store));
  app.use('/api', invoicingRoutes(store));

  // Serve the built client in production.
  const clientDist = path.resolve(process.cwd(), '../client/dist');
  if (config.nodeEnv === 'production' && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  // 404 for unknown /api/* paths.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { message: 'Not found' } });
  });

  // Error handler.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', { err: err.message, stack: err.stack });
    res.status(500).json({ error: { message: 'Internal server error' } });
  });

  return app;
}

export async function startServer(): Promise<{ app: express.Express; server: ReturnType<express.Express['listen']> }> {
  const app = createApp();
  const server = await new Promise<ReturnType<express.Express['listen']>>((resolve) => {
    const s = app.listen(config.port, () => resolve(s));
  });
  logger.info('TradePro CRM started', { port: config.port, store: config.supabase.configured ? 'supabase' : 'local', resend: config.resend.configured });
  return { app, server };
}