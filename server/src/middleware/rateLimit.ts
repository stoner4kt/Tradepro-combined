import { createClient } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../utils/config.js';
import { sendError } from '../lib/http.js';

const client = config.supabase.configured
  ? createClient(config.supabase.url,config.supabase.serviceKey,{auth:{autoRefreshToken:false,persistSession:false}})
  : null;

export function rateLimit(options:{scope:string;windowSeconds:number;max:number;failClosed?:boolean}) {
 return async (req:Request,res:Response,next:NextFunction):Promise<void>=>{
  if(!client){if(options.failClosed){sendError(res,503,'Rate limiting unavailable');return;}next();return;}
  const forwarded=String(req.headers['cf-connecting-ip']||req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
  const email=String(req.body?.email||'').trim().toLowerCase();
  const key=`${options.scope}:${forwarded}:${email}`.slice(0,512);
  try{
   const {data,error}=await client.rpc('rate_limit_hit',{p_key:key,p_window_seconds:options.windowSeconds,p_max:options.max});
   if(error)throw error;
   const row=Array.isArray(data)?data[0]:data;
   if(!row?.allowed){res.setHeader('Retry-After',String(Math.max(1,row?.retry_after||60)));sendError(res,429,'Too many requests');return;}
   next();
  }catch(err){
   if(options.failClosed){sendError(res,503,'Rate limiting unavailable');return;}
   next();
  }
 };
}
