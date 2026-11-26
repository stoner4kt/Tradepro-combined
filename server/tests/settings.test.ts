import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type express from 'express';
import { createApp } from '../src/app.js';
import { authToken } from './helpers.js';

describe('Settings API', () => {
  let app: express.Express;
  let token: string;

  beforeAll(async () => {
    app = createApp();
    token = await authToken(app, 'settings@example.com');
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('GETs /api/settings and returns 200', async () => {
    const res = await request(app).get('/api/settings').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.settings).toBeDefined();
  });

  it('PATCHes /api/settings with currency ZAR and returns 200', async () => {
    const res = await request(app)
      .patch('/api/settings')
      .set(auth())
      .send({ currency: 'ZAR' });
    expect(res.status).toBe(200);
    expect(res.body.settings.currency).toBe('ZAR');
  });

  it('PUT /api/settings now returns 404', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(auth())
      .send({ currency: 'ZAR' });
    expect(res.status).toBe(404);
  });
});