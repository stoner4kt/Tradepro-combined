import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import type express from 'express';
import { createApp } from '../src/app.js';
import { authToken } from './helpers.js';

// The Invoicing proxy is env-gated (config.invoicing.enabled). Without a URL
// AND secret configured every /api/invoicing route serves a 404 so a pure-CRM
// deploy is unaffected — the same behaviour as /api/integration/reviews.
// These tests lock in that contract (they do NOT require the edge functions).
describe('Invoicing integration (unconfigured)', () => {
  let app: express.Express;
  let token: string;

  beforeAll(async () => {
    app = createApp();
    token = await authToken(app, 'invoicing-disabled@example.com');
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('requires auth', async () => {
    const res = await request(app).get('/api/invoicing/documents');
    expect(res.status).toBe(401);
  });

  it('returns 404 for documents/settings/revenue when the integration is disabled', async () => {
    for (const path of ['/api/invoicing/documents', '/api/invoicing/settings', '/api/invoicing/revenue']) {
      const res = await request(app).get(path).set(auth());
      expect(res.status, path).toBe(404);
    }
  });

  it('blocks unsupported document actions even when enabled via env', async () => {
    // config.ts reads env at import time, so re-import the module tree with a
    // bogus-but-set URL/secret to exercise the allowlist against a real app.
    vi.resetModules();
    const prev = process.env.INVOICING_URL;
    process.env.INVOICING_URL = 'http://localhost:1';
    process.env.INVOICING_SECRET = 'test-secret';
    const { createApp: freshCreateApp } = await import('../src/app.js');
    const enabledApp = freshCreateApp();
    // A fresh app has a fresh in-memory store — mint a token against it.
    const freshToken = await authToken(enabledApp, 'invoicing-enabled@example.com');

    let res = await request(enabledApp)
      .post('/api/invoicing/documents/abc/delete-everything')
      .set({ Authorization: `Bearer ${freshToken}` });
    expect(res.status).toBe(400);

    // from-project requires a projectId
    res = await request(enabledApp)
      .post('/api/invoicing/from-project')
      .set({ Authorization: `Bearer ${freshToken}` })
      .send({});
    expect(res.status).toBe(400);

    // content must be pdf|view|download
    res = await request(enabledApp)
      .get('/api/invoicing/documents/abc/content/xml')
      .set({ Authorization: `Bearer ${freshToken}` });
    expect(res.status).toBe(400);

    if (prev === undefined) delete process.env.INVOICING_URL;
    else process.env.INVOICING_URL = prev;
    delete process.env.INVOICING_SECRET;
    vi.resetModules();
  });
});