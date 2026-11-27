import type { Request, Response, NextFunction } from 'express';
import { verifyUserToken } from '../lib/jwt.js';
import { sendError } from '../lib/http.js';
import { AuthService } from '../services/authService.js';
import type { AuthUser } from '../services/authService.js';

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

// Attach AuthService to requests for /me lookups.
export function authServiceMiddleware(authService: AuthService) {
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as AuthedRequest & { authService?: AuthService }).authService = authService;
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('tradepro_session='))?.slice('tradepro_session='.length);
  const header = req.headers.authorization;
  const bearerAllowed = process.env.ALLOW_BEARER_AUTH === 'true';
  const tokenValue = cookie || (bearerAllowed && header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '');
  if (!tokenValue) {
    sendError(res, 401, 'Missing authorization token');
    return;
  }

  const claims = verifyUserToken(tokenValue);
  if (!claims) {
    sendError(res, 401, 'Invalid or expired token');
    return;
  }

  const service = (req as AuthedRequest & { authService?: AuthService }).authService;
  if (!service) {
    sendError(res, 500, 'Auth service unavailable');
    return;
  }

  void service
    .me(claims.sub)
    .then(async (user) => {
      if (!user) {
        sendError(res, 401, 'Account not found');
        return;
      }
      if (!(await service.isTokenVersionValid(claims.sub, claims.token_version ?? 0))) {
        sendError(res, 401, 'Session revoked');
        return;
      }
      const limit = await service.allowAuthenticatedRequest(user.id);
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfter));
        sendError(res, 429, 'Too many requests');
        return;
      }
      (req as AuthedRequest).user = user;
      next();
    })
    .catch(() => {
      sendError(res, 500, 'Auth check failed');
    });
}