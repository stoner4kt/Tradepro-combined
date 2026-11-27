import jwt from 'jsonwebtoken';
import { config } from '../utils/config.js';
import type { User } from '../types/domain.js';

export interface UserClaims {
  sub: string;
  email: string;
  full_name?: string;
  business_name?: string;
}

export function signUserToken(user: Pick<User, 'id' | 'email' | 'fullName' | 'businessName'>): string {
  const claims: UserClaims = {
    sub: user.id,
    email: user.email,
    full_name: user.fullName,
    business_name: user.businessName,
  };
  return jwt.sign(claims, config.jwtSecret, { algorithm: 'HS256', issuer: 'tradepro-api', audience: 'tradepro-client', expiresIn: '8h' });
}

export function verifyUserToken(token: string): UserClaims | null {
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: 'tradepro-api', audience: 'tradepro-client' }) as UserClaims;
  } catch {
    return null;
  }
}