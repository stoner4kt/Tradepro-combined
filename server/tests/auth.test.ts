import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type express from 'express';
import { createApp } from '../src/app.js';

const PASSWORD = 'S3cure!TradePro2026';
function sessionToken(res: { headers: Record<string, unknown> }): string {
  const cookies = res.headers['set-cookie'] as string[] | undefined;
  const cookie = cookies?.find(value => value.startsWith('tradepro_session='));
  if (!cookie) throw new Error('Expected HttpOnly session cookie');
  return decodeURIComponent(cookie.split(';', 1)[0].slice('tradepro_session='.length));
}

describe('Auth API', () => {
  let app: express.Express;

  beforeAll(() => {
    app = createApp();
  });

  it('registers a new user and sets an HttpOnly session cookie', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'plumber@example.com',
      password: PASSWORD,
      fullName: 'Bob the Plumber',
      businessName: 'Bob Plumbing',
      businessType: 'plumbing',
    });
    expect(res.status).toBe(201);
    expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(res.body.token).toBeUndefined();
    expect(res.body.user.email).toBe('plumber@example.com');
    expect(res.body.user.businessName).toBe('Bob Plumbing');
    expect(res.body.provider).toBe('local');
  });

  it('logs in with correct credentials and refreshes the session cookie', async () => {
    await request(app).post('/api/auth/register').send({ email: 'electric@example.com', password: PASSWORD });
    const res = await request(app).post('/api/auth/login').send({ email: 'electric@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(res.body.token).toBeUndefined();
  });

  it('rejects login with wrong password using a generic error', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'electric@example.com', password: 'Wrong!Passphrase2026' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('rejects duplicate registration without disclosing account details', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'plumber@example.com', password: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Unable to register with these details');
  });

  it('protects /me and returns the profile for an authenticated session', async () => {
    const noAuth = await request(app).get('/api/auth/me');
    expect(noAuth.status).toBe(401);

    const reg = await request(app).post('/api/auth/register').send({ email: 'roofer@example.com', password: PASSWORD });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${sessionToken(reg)}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('roofer@example.com');
  });

  it('updates the profile via PATCH /profile', async () => {
    const reg = await request(app).post('/api/auth/register').send({ email: 'hvac@example.com', password: PASSWORD });
    const res = await request(app).patch('/api/auth/profile')
      .set('Authorization', `Bearer ${sessionToken(reg)}`)
      .send({ fullName: 'Cool Air HVAC', businessType: 'hvac' });
    expect(res.status).toBe(200);
    expect(res.body.user.fullName).toBe('Cool Air HVAC');
    expect(res.body.user.businessType).toBe('hvac');
  });

  it('supports password changes and rejects malformed reset requests', async () => {
    const reg = await request(app).post('/api/auth/register').send({ email: 'password@example.com', password: PASSWORD });
    const change = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${sessionToken(reg)}`)
      .send({ currentPassword: PASSWORD, newPassword: 'Different!TradePro2026' });
    expect(change.status).toBe(200);
    expect(change.headers['set-cookie']?.[0]).toContain('HttpOnly');

    const reset = await request(app).post('/api/auth/reset-password').send({ email: 'plumber@example.com' });
    expect(reset.status).toBe(400);
  });

  it('clears the session cookie on logout', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']?.[0]).toContain('tradepro_session=');
  });
});
