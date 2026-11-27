import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Store } from '../store/Store.js';
import { signUserToken } from '../lib/jwt.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { User } from '../types/domain.js';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  businessName: string;
  businessType: string;
  phone: string;
}

export interface AuthSuccess {
  token: string;
  user: AuthUser;
  provider: 'supabase' | 'local';
}

export interface AuthFailure {
  error: string;
  status: number;
  provider: 'supabase' | 'local';
}

export interface AuthPending { pending: true; message: string; provider: 'supabase' | 'local' }
export type AuthResult = AuthSuccess | AuthFailure | AuthPending;

export function isSuccess(r: AuthResult): r is AuthSuccess {
  return 'token' in r;
}

function toAuthUser(u: User): AuthUser {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    businessName: u.businessName,
    businessType: u.businessType,
    phone: u.phone,
  };
}

// ---------------------------------------------------------------------------
// Auth service. Uses Supabase Auth (signUp / signInWithPassword) when it is
// configured. Falls back to LocalStore (bcrypt + local JWT) for development.
// ---------------------------------------------------------------------------
export class AuthService {
  private local: Store;
  private admin: SupabaseClient | null = null;

  constructor(store: Store) {
    this.local = store;
    if (config.supabase.configured) {
      this.admin = createClient(config.supabase.url, config.supabase.serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
  }

  get useSupabase(): boolean {
    return this.admin !== null;
  }

  private async passwordPolicyError(password:string):Promise<string|null>{
    if(password.length<10||password.length>128)return 'Password must be 10–128 characters';
    if(new Set(['password123','password1234','1234567890','qwerty12345','letmein1234','welcome1234']).has(password.toLowerCase()))return 'Choose a less common password';
    try{
      const digest=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(password));
      const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
      const prefix=hash.slice(0,5),suffix=hash.slice(5);
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),3000);
      const response=await fetch(`https://api.pwnedpasswords.com/range/${prefix}`,{headers:{'Add-Padding':'true'},signal:controller.signal}).finally(()=>clearTimeout(timeout));
      if(!response.ok)throw new Error(`HIBP status ${response.status}`);
      const matches=(await response.text()).split(/\r?\n/).some(line=>{const [candidate,count]=line.split(':');return candidate===suffix&&Number(count)>0;});
      if(matches)return 'Choose a password that has not appeared in known data breaches';
    }catch(err){logger.warn('Password breach check unavailable; continuing with local policy',{error:(err as Error).message});}
    return null;
  }

  async register(input: {
    email: string;
    password: string;
    fullName?: string;
    businessName?: string;
    businessType?: string;
    phone?: string;
  }): Promise<AuthResult> {
    const policyError = await this.passwordPolicyError(input.password);
    if (policyError) return { error: policyError, status: 400, provider: this.admin ? 'supabase' : 'local' };
    if (this.admin) {
      try {
        const { data, error } = await this.admin.auth.admin.createUser({
          email: input.email.toLowerCase().trim(),
          password: input.password,
          email_confirm: false,
          user_metadata: { full_name: input.fullName ?? '', business_name: input.businessName ?? '', business_type: input.businessType ?? '', phone: input.phone ?? '' },
        });
        if (error || !data.user) return { error: 'Unable to create account', status: 400, provider: 'supabase' };
        try {
          const rawToken = await this.createAuthToken(data.user.id, 'email_verify', 24 * 60 * 60);
          await this.sendAuthLink(data.user.email || input.email, 'verify-email', rawToken, 'Verify your TradePro email');
        } catch (deliveryError) {
          logger.warn('Registration created but verification delivery needs retry', { error: (deliveryError as Error).message });
        }
        return { pending: true, message: 'If registration can be completed, a verification email will be sent shortly.', provider: 'supabase' };
      } catch (err) {
        logger.error('Supabase signUp failed', { err: (err as Error).message });
        return { error: 'Supabase sign up failed', status: 500, provider: 'supabase' };
      }
    }

    try {
      const user = await this.local.createUser(input);
      return { token: signUserToken(user), user: toAuthUser(user), provider: 'local' };
    } catch (err) {
      const status = (err as Error & { code?: string }).code === 'DUPLICATE_EMAIL' ? 409 : 500;
      return { error: (err as Error).message, status, provider: 'local' };
    }
  }

  private async createAuthToken(userId: string, purpose: 'email_verify' | 'password_reset', ttlSeconds: number): Promise<string> {
    if (!this.admin) throw new Error('Supabase auth tokens require the production data store');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const raw = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const { error } = await this.admin.from('auth_tokens').insert({ user_id: userId, purpose, token_hash: tokenHash, expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString() });
    if (error) throw error;
    return raw;
  }

  private async sendAuthLink(email: string, path: string, token: string, subject: string): Promise<void> {
    if (!config.resend.apiKey || !config.appOrigin || !config.resend.fromEmail) throw new Error('Email verification delivery is not configured');
    const url = `${config.appOrigin.replace(/\/+$/, '')}/${path}?token=${encodeURIComponent(token)}`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resend.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.resend.fromEmail, to: [email], subject, html: `<p>Use this secure, single-use link:</p><p><a href="${url}">Continue to TradePro</a></p><p>This link expires soon. If you did not request it, ignore this email.</p>` }),
    });
    if (!response.ok) throw new Error('Unable to deliver authentication email');
  }

  async verifyEmail(rawToken: string): Promise<AuthSuccess | null> {
    if (!this.admin) return null;
    const hash = await this.hashToken(rawToken);
    const { data: row } = await this.admin.from('auth_tokens').select('id,user_id,expires_at,used_at').eq('purpose','email_verify').eq('token_hash',hash).maybeSingle();
    if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) return null;
    const { data: consumed } = await this.admin.from('auth_tokens').update({ used_at: new Date().toISOString() }).eq('id',row.id).is('used_at',null).select('id').maybeSingle();
    if (!consumed) return null;
    const { error } = await this.admin.auth.admin.updateUserById(row.user_id,{email_confirm:true});
    if (error) return null;
    await this.admin.from('profiles').update({email_verified_at:new Date().toISOString()}).eq('id',row.user_id);
    const profile=await this.sbProfile(row.user_id,'');
    return {token:signUserToken(profile, await this.getTokenVersion(row.user_id)),user:toAuthUser(profile),provider:'supabase'};
  }

  private async hashToken(rawToken:string):Promise<string>{
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rawToken));
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  }

  async resendVerification(email:string):Promise<void>{
    if(!this.admin)return;
    const user=await this.local.findByEmail(email);
    if(!user)return;
    const {data}=await this.admin.auth.admin.getUserById(user.id);
    if(!data.user || data.user.email_confirmed_at)return;
    const token=await this.createAuthToken(user.id,'email_verify',24*60*60);
    await this.sendAuthLink(email,'verify-email',token,'Verify your TradePro email');
  }

  async requestPasswordReset(email:string):Promise<void>{
    if(!this.admin)return;
    const user=await this.local.findByEmail(email);
    if(!user)return;
    const token=await this.createAuthToken(user.id,'password_reset',3600);
    await this.sendAuthLink(email,'reset-password',token,'Reset your TradePro password');
  }

  async completePasswordReset(rawToken:string,newPassword:string):Promise<boolean>{
    if(!this.admin)return false;
    if(await this.passwordPolicyError(newPassword))return false;
    const hash=await this.hashToken(rawToken);
    const {data:row}=await this.admin.from('auth_tokens').select('id,user_id,expires_at,used_at').eq('purpose','password_reset').eq('token_hash',hash).maybeSingle();
    if(!row||row.used_at||Date.parse(row.expires_at)<=Date.now())return false;
    const {data:consumed}=await this.admin.from('auth_tokens').update({used_at:new Date().toISOString()}).eq('id',row.id).is('used_at',null).select('id').maybeSingle();
    if(!consumed)return false;
    const {error}=await this.admin.auth.admin.updateUserById(row.user_id,{password:newPassword});
    if(error)return false;
    await this.bumpTokenVersion(row.user_id);
    return true;
  }

  async bumpTokenVersion(userId:string):Promise<number>{
    if(!this.admin)return 0;
    const {data,error}=await this.admin.rpc('increment_token_version',{p_user_id:userId});
    if(error)throw error;
    return Number(data);
  }

  async isTokenVersionValid(userId:string,version:number):Promise<boolean>{return (await this.getTokenVersion(userId))===version;}

  async getTokenVersion(userId:string):Promise<number>{
    if(!this.admin)return 0;
    const {data}=await this.admin.from('profiles').select('token_version').eq('id',userId).maybeSingle();
    return Number(data?.token_version||0);
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    if (this.admin) {
      try {
        const { data, error } = await this.admin.auth.signInWithPassword({
          email: input.email.toLowerCase().trim(),
          password: input.password,
        });
        if (error || !data.user || !data.user.email_confirmed_at) {
          return { error: error?.message || 'Invalid credentials', status: 401, provider: 'supabase' };
        }
        const user = await this.sbProfile(data.user.id, data.user.email ?? input.email);
        return { token: signUserToken(user, await this.getTokenVersion(user.id)), user: toAuthUser(user), provider: 'supabase' };
      } catch (err) {
        logger.error('Supabase login failed', { err: (err as Error).message });
        return { error: 'Supabase login failed', status: 500, provider: 'supabase' };
      }
    }

    const user = await this.local.findByEmail(input.email);
    if (!user) return { error: 'Invalid email or password', status: 401, provider: 'local' };
    const valid = await this.local.verifyPassword(user, input.password);
    if (!valid) return { error: 'Invalid email or password', status: 401, provider: 'local' };
    return { token: signUserToken(user), user: toAuthUser(user), provider: 'local' };
  }

  async me(userId: string): Promise<AuthUser | null> {
    const local = await this.local.findById(userId);
    if (local) return toAuthUser(local);
    if (this.admin) {
      const profile = await this.profile(userId);
      if (profile) return toAuthUser(profile);
    }
    return null;
  }

  // Data-layer passthroughs (so routes can share the single store instance).
  async updateProfile(id: string, patch: { fullName?: string; businessName?: string; businessType?: string; phone?: string }) {
    return this.local.updateProfile(id, patch as never);
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.local.findById(userId);
    if (!user) return false;
    return this.local.verifyPassword(user, password);
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    await this.local.updatePassword(id, newPassword);
  }

  async changePassword(userId:string,currentPassword:string,newPassword:string):Promise<string|null>{
    const policy=await this.passwordPolicyError(newPassword);if(policy)return null;
    const user=await this.local.findById(userId);if(!user)return null;
    if(this.admin){
      const {error:authError}=await this.admin.auth.signInWithPassword({email:user.email,password:currentPassword});
      if(authError)return null;
      const {error}=await this.admin.auth.admin.updateUserById(userId,{password:newPassword});
      if(error)return null;
      const version=await this.bumpTokenVersion(userId);
      return signUserToken(user,version);
    }
    if(!(await this.local.verifyPassword(user,currentPassword)))return null;
    await this.local.updatePassword(userId,newPassword);
    return signUserToken(user);
  }

  async updatePasswordAdmin(id: string, newPassword: string): Promise<void> {
    if (!this.admin) throw new Error('Supabase not configured');
    await this.admin.auth.admin.updateUserById(id, { password: newPassword });
  }

  async resetPassword(email: string, opts: { redirectTo: string }): Promise<void> {
    if (!this.admin) throw new Error('Supabase not configured');
    await this.admin.auth.resetPasswordForEmail(email, { redirectTo: opts.redirectTo });
  }

  private async sbProfile(id: string, email: string): Promise<User> {
    const { data } = await this.admin!.from('profiles').select('*').eq('id', id).maybeSingle();
    if (data) return mapSupabaseProfile(data);
    return {
      id,
      email,
      fullName: '',
      businessName: '',
      businessType: '',
      phone: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private async profile(id: string): Promise<User | null> {
    const { data } = await this.admin!.from('profiles').select('*').eq('id', id).maybeSingle();
    return data ? mapSupabaseProfile(data) : null;
  }

  private baseUrl(): string {
    return process.env.PUBLIC_BASE_URL || `http://localhost:${config.port}`;
  }
}

function mapSupabaseProfile(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email ?? ''),
    fullName: String(row.full_name ?? ''),
    businessName: String(row.business_name ?? ''),
    businessType: String(row.business_type ?? '') as User['businessType'],
    phone: String(row.phone ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}
