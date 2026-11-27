import { createClient } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../utils/config.js';
import { sendError } from '../lib/http.js';
import { logger } from '../utils/logger.js';

const client = config.supabase.configured
  ? createClient(config.supabase.url,config.supabase.serviceKey,{auth:{autoRefreshToken:false,persistSession:false}})
  : null;

export function rateLimit(options:{scope:string;windowSeconds:number;max:number;failClosed?:boolean;keyBy?:"ip"|"email"|"ip_email"}) {
 return async (req:Request,res:Response,next:NextFunction):Promise<void>=>{
  if(!client){if(options.failClosed){sendError(res,503,'Rate limiting unavailable');return;}logger.warn('Rate limiter not configured; failing open',{scope:options.scope});next();return;}
  const forwarded=String(req.headers['cf-connecting-ip']||req.socket.remoteAddress||'unknown').slice(0,64);
  const email=String(req.body?.email||'').trim().toLowerCase();
  const keyBy=options.keyBy||"ip_email";
  const rawKey=keyBy==="ip"?`${options.scope}:${forwarded}`:keyBy==="email"?`${options.scope}:${email||"missing-email"}`:`${options.scope}:${forwarded}:${email}`;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rawKey));
  const key=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  try{
   const {data,error}=await client.rpc('rate_limit_hit',{p_key:key,p_window_seconds:options.windowSeconds,p_max:options.max});
   if(error)throw error;
   const row=Array.isArray(data)?data[0]:data;
   if(!row?.allowed){res.setHeader('Retry-After',String(Math.max(1,row?.retry_after||60)));sendError(res,429,'Too many requests');return;}
   next();
  }catch(err){
   if(options.failClosed){sendError(res,503,'Rate limiting unavailable');return;}
   logger.warn('Rate limiter query failed; failing open',{scope:options.scope,error:(err as Error).message});
   next();
  }
 };
}
