import { Router } from 'express';
import { AuthService, isSuccess } from '../services/authService.js';
import { asyncHandler, sendError } from '../lib/http.js';
import { loginSchema, registerSchema, profileUpdateSchema, passwordChangeSchema } from '../utils/validation.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import type { Store } from '../store/Store.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { config } from '../utils/config.js';

export function authRoutes(authService: AuthService): Router {
  const router = Router();

  router.post(
    '/register',
    rateLimit({ scope: 'auth-register', windowSeconds: 3600, max: 5, failClosed: config.isProduction }),
    asyncHandler(async (req, res) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, 400, 'Invalid input', parsed.error.flatten().fieldErrors);
      }
      const result = await authService.register(parsed.data);
      if ('pending' in result) return res.status(202).json({ message: result.message });
      if (!isSuccess(result)) return sendError(res, result.status, 'Unable to register with these details');
      if (result.token) res.cookie('tradepro_session', result.token, { httpOnly: true, secure: config.isProduction, sameSite: config.isProduction ? 'none' : 'lax', domain: config.cookieDomain || undefined, path: '/', maxAge: 8 * 60 * 60 * 1000 });
      res.status(201).json({ user: result.user, provider: result.provider });
    }),
  );

  router.post(
    '/login',
    rateLimit({ scope: 'auth-login', windowSeconds: 900, max: 5, failClosed: config.isProduction }),
    asyncHandler(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, 400, 'Invalid input', parsed.error.flatten().fieldErrors);
      }
      const result = await authService.login(parsed.data);
      if (!isSuccess(result)) return sendError(res, 'status' in result ? result.status : 401, 'Invalid email or password');
      res.cookie('tradepro_session', result.token, { httpOnly: true, secure: config.isProduction, sameSite: config.isProduction ? 'none' : 'lax', domain: config.cookieDomain || undefined, path: '/', maxAge: 8 * 60 * 60 * 1000 });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ user: result.user, provider: result.provider });
    }),
  );

  router.post('/logout', (req, res) => { res.clearCookie('tradepro_session', { httpOnly: true, secure: config.isProduction, sameSite: config.isProduction ? 'none' : 'lax', domain: config.cookieDomain || undefined, path: '/' }); res.status(204).end(); });


  router.post('/verify-email', rateLimit({scope:'auth-verify-email',windowSeconds:3600,max:10,failClosed:config.isProduction}), asyncHandler(async (req,res)=>{
    const token=typeof req.body?.token==='string'?req.body.token:'';
    if(!token || token.length>256)return sendError(res,400,'Invalid or expired verification link');
    const result=await authService.verifyEmail(token);
    if(!result)return sendError(res,400,'Invalid or expired verification link');
    res.cookie('tradepro_session',result.token,{httpOnly:true,secure:config.isProduction,sameSite:config.isProduction?'none':'lax',domain:config.cookieDomain||undefined,path:'/',maxAge:8*60*60*1000});
    res.setHeader('Cache-Control','no-store');
    return res.json({user:result.user});
  }));

  router.post('/resend-verification',rateLimit({scope:'auth-resend-verification',windowSeconds:3600,max:3,failClosed:config.isProduction}),asyncHandler(async(req,res)=>{
    const email=typeof req.body?.email==='string'?req.body.email:'';
    if(email.length<=254){try{await authService.resendVerification(email.toLowerCase().trim());}catch{/* generic response */}}
    return res.status(200).json({message:'If the account needs verification, a new link will be sent.'});
  }));

  router.post('/forgot-password',rateLimit({scope:'auth-forgot',windowSeconds:3600,max:3,failClosed:config.isProduction}),asyncHandler(async(req,res)=>{
    const email=typeof req.body?.email==='string'?req.body.email:'';
    if(email.length<=254){try{await authService.requestPasswordReset(email.toLowerCase().trim());}catch{/* identical public response */}}
    return res.status(200).json({message:'If an account exists for that email, password reset instructions will be sent.'});
  }));

  router.post('/reset-password',rateLimit({scope:'auth-reset',windowSeconds:3600,max:5,failClosed:config.isProduction}),asyncHandler(async(req,res)=>{
    const token=typeof req.body?.token==='string'?req.body.token:'';
    const password=typeof req.body?.password==='string'?req.body.password:'';
    if(token.length<32||token.length>256||password.length<10||password.length>128)return sendError(res,400,'Invalid reset request');
    const ok=await authService.completePasswordReset(token,password);
    if(!ok)return sendError(res,400,'Invalid or expired reset link');
    res.clearCookie('tradepro_session',{httpOnly:true,secure:config.isProduction,sameSite:config.isProduction?'none':'lax',domain:config.cookieDomain||undefined,path:'/'});
    return res.json({message:'Password updated. Please sign in again.'});
  }));

  router.post('/logout-all',requireAuth,asyncHandler(async(req,res)=>{
    const user=(req as AuthedRequest).user!;
    await authService.bumpTokenVersion(user.id);
    res.clearCookie('tradepro_session',{httpOnly:true,secure:config.isProduction,sameSite:'lax',domain:config.cookieDomain||undefined,path:'/'});
    return res.status(204).end();
  }));

  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({ user: (req as AuthedRequest).user });
    }),
  );

  router.post('/change-password',requireAuth,asyncHandler(async(req,res)=>{
    const parsed=passwordChangeSchema.safeParse(req.body);
    if(!parsed.success)return sendError(res,400,'Invalid password change request');
    const user=(req as AuthedRequest).user!;
    const token=await authService.changePassword(user.id,parsed.data.currentPassword,parsed.data.newPassword);
    if(!token)return sendError(res,400,'Current password is incorrect or the new password does not meet policy');
    res.cookie('tradepro_session',token,{httpOnly:true,secure:config.isProduction,sameSite:'lax',domain:config.cookieDomain||undefined,path:'/',maxAge:8*60*60*1000});
    res.setHeader('Cache-Control','no-store');
    return res.json({message:'Password updated'});
  }));

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