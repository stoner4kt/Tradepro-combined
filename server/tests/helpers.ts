import request from 'supertest';
import type express from 'express';

export function register(agent: ReturnType<typeof request.agent>, email: string) {
  return agent.post('/api/auth/register').send({
    email,
    password: 'S3cure!TradePro2026',
    fullName: 'Test Owner',
    businessName: 'Test Plumbing Co',
    businessType: 'plumbing',
  });
}

export function login(agent: ReturnType<typeof request.agent>, email: string) {
  return agent.post('/api/auth/login').send({ email, password: 'S3cure!TradePro2026' });
}

export async function authToken(app: express.Express, email: string): Promise<string> {
  const res = await request(app).post('/api/auth/register').send({
    email,
    password: 'S3cure!TradePro2026',
    fullName: 'Test Owner',
    businessName: 'Test Plumbing Co',
    businessType: 'plumbing',
  });
  const cookies = res.headers['set-cookie'] as string[] | undefined;
  const session = cookies?.find(value => value.startsWith('tradepro_session='));
  if (!session) throw new Error('Registration did not set a session cookie');
  return decodeURIComponent(session.split(';', 1)[0].slice('tradepro_session='.length));
}