// Resend webhook verification follows Svix's signed timestamp scheme.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { adminClient } from "../_shared/invoicing/supabase.ts";

import { verifySvix } from "../_shared/svix.ts";

const encoder = new TextEncoder();
const STATUS_MAP:Record<string,string>={
 "email.delivered":"delivered","email.bounced":"bounced","email.complained":"complained",
 "email.sent":"sent","email.opened":"sent","email.clicked":"sent"
};
serve(async(req:Request):Promise<Response>=>{
 if(req.method==="OPTIONS") return new Response(null,{status:204});
 if(req.method!=="POST") return json({error:"Method not allowed"},405);
 const raw=await req.text(); if(!raw || raw.length>256_000) return json({error:"Invalid request"},400);
 const verifiedId=await verifySvix(raw,req.headers,Deno.env.get("RESEND_WEBHOOK_SECRET")||""); if(!verifiedId) return json({error:"Invalid signature"},401);
 let event:{type?:string;data?:{email_id?:string;id?:string}};
 try{event=JSON.parse(raw);}catch{return json({error:"Invalid request"},400);}
 const status=STATUS_MAP[event.type||""]; const messageId=event.data?.email_id;
 if(!status || !messageId) return json({ok:true,ignored:true});
 try{
  const admin=adminClient();
  const ip=(req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||"unknown").split(",")[0].slice(0,64);
  const ipDigest=await crypto.subtle.digest("SHA-256",encoder.encode("resend-webhook:"+ip));
  const rateKey=Array.from(new Uint8Array(ipDigest),b=>b.toString(16).padStart(2,"0")).join("");
  const {data:rateData,error:rateError}=await admin.schema("public").rpc("rate_limit_hit",{p_key:rateKey,p_window_seconds:60,p_max:120});
  const rate=Array.isArray(rateData)?rateData[0]:rateData;
  if(rateError)return json({error:"Webhook rate limiter unavailable"},503);
  if(!rate?.allowed)return json({error:"Too many webhook requests"},429);

  // Unique insert serializes concurrent deliveries with the same Svix ID.
  const {error:claimError}=await admin.from("webhook_receipts").insert({svix_id:verifiedId});
  if(claimError?.code==="23505")return json({ok:true,duplicate:true});
  if(claimError)return json({error:"Webhook processing unavailable"},500);
  const {data:row,error}=await admin.from("email_events").select("id,meta,status").eq("message_id",messageId).maybeSingle();
  if(error){await admin.from("webhook_receipts").delete().eq("svix_id",verifiedId);return json({error:"Webhook processing unavailable"},500);}
  if(row){
    const priority:Record<string,number>={queued:0,sent:1,delivered:2,bounced:3,complained:4,failed:3};
    const current=String(row.status||"queued");
    if((priority[status]??0)>(priority[current]??0)){
      const meta={...((row.meta&&typeof row.meta==="object")?row.meta:{}),webhook_type:event.type,svix_id:verifiedId};
      const {error:updateError}=await admin.from("email_events").update({status,meta}).eq("id",row.id);
      if(updateError){await admin.from("webhook_receipts").delete().eq("svix_id",verifiedId);return json({error:"Webhook processing unavailable"},500);}
    }
  }
  return json({ok:true,ignored:!row});
 }catch{return json({error:"Webhook processing unavailable"},500);}
});
function json(data:unknown,status=200):Response{return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
