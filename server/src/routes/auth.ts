import { Router } from 'express';
import { AuthService, isSuccess } from '../services/authService.js';
import { asyncHandler, sendError } from '../lib/http.js';
import { loginSchema, registerSchema, profileUpdateSchema } from '../utils/validation.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import type { Store } from '../store/Store.js';

export function authRoutes(authService: AuthService): Router {
  const router = Router();

  router.post(
    '/register',
    asyncHandler(async (req, res) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, 400, 'Invalid input', parsed.error.flatten().fieldErrors);
      }
      const result = await authService.register(parsed.data);
      if (!isSuccess(result)) {
        return sendError(res, result.status, result.error);
      }
      res.status(201).json({ token: result.token, user: result.user, provider: result.provider });
    }),
  );

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, 400, 'Invalid input', parsed.error.flatten().fieldErrors);
      }
      const result = await authService.login(parsed.data);
      if (!isSuccess(result)) {
        return sendError(res, result.status, result.error);
      }
      res.json({ token: result.token, user: result.user, provider: result.provider });
    }),
  );

  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({ user: (req as AuthedRequest).user });
    }),
  );

  router.patch(
    '/profile',
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = profileUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, 400, 'Invalid input', parsed.error.flatten().fieldErrors);
      }
      const user = (req as AuthedRequest).user!;
      const updated = await authService.updateProfile(user.id, parsed.data);
      if (!updated) return sendError(res, 404, 'Profile not found');
      res.json({ user: updated });
    }),
  );

  return router;
}