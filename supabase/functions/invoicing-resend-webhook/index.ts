// Resend webhook verification follows Svix's signed timestamp scheme.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { adminClient } from "../_shared/invoicing/supabase.ts";

const encoder = new TextEncoder();
function constantTimeEqual(a: Uint8Array,b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++) diff |= a[i]^b[i];
  return diff===0;
}
async function verifySvix(raw: string, req: Request): Promise<{id:string}|null> {
  const secret=Deno.env.get("RESEND_WEBHOOK_SECRET") || "";
  const id=req.headers.get("svix-id") || "";
  const timestamp=req.headers.get("svix-timestamp") || "";
  const signatures=req.headers.get("svix-signature") || "";
  if(!secret.startsWith("whsec_") || !id || !timestamp || !signatures) return null;
  const ts=Number(timestamp);
  if(!Number.isInteger(ts) || Math.abs(Date.now()/1000-ts)>300) return null;
  try {
    const keyBytes=Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0));
    const key=await crypto.subtle.importKey("raw",keyBytes,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const signed=encoder.encode(`${id}.${timestamp}.${raw}`);
    const expected=new Uint8Array(await crypto.subtle.sign("HMAC",key,signed));
    const valid=signatures.split(" ").some(part=>{
      const [version,value]=part.split(",",2);
      if(version!=="v1" || !value) return false;
      try { return constantTimeEqual(expected,Uint8Array.from(atob(value),c=>c.charCodeAt(0))); } catch { return false; }
    });
    return valid?{id}:null;
  } catch { return null; }
}
const STATUS_MAP:Record<string,string>={
 "email.delivered":"delivered","email.bounced":"bounced","email.complained":"complained",
 "email.sent":"sent","email.opened":"sent","email.clicked":"sent"
};
serve(async(req:Request):Promise<Response>=>{
 if(req.method==="OPTIONS") return new Response(null,{status:204});
 if(req.method!=="POST") return json({error:"Method not allowed"},405);
 const raw=await req.text(); if(!raw) return json({error:"Invalid request"},400);
 const verified=await verifySvix(raw,req); if(!verified) return json({error:"Invalid signature"},401);
 let event:{type?:string;data?:{email_id?:string;id?:string}};
 try{event=JSON.parse(raw);}catch{return json({error:"Invalid request"},400);}
 const status=STATUS_MAP[event.type||""]; const messageId=event.data?.email_id||event.data?.id;
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
  const {error:claimError}=await admin.from("webhook_receipts").insert({svix_id:verified.id});
  if(claimError?.code==="23505")return json({ok:true,duplicate:true});
  if(claimError)return json({error:"Webhook processing unavailable"},500);
  const {data:row,error}=await admin.from("email_events").select("id,meta,status").eq("message_id",messageId).maybeSingle();
  if(error){await admin.from("webhook_receipts").delete().eq("svix_id",verified.id);return json({error:"Webhook processing unavailable"},500);}
  if(row){
    const priority:Record<string,number>={queued:0,sent:1,delivered:2,bounced:3,complained:4,failed:3};
    const current=String(row.status||"queued");
    if((priority[status]??0)>(priority[current]??0)){
      const meta={...((row.meta&&typeof row.meta==="object")?row.meta:{}),webhook_type:event.type,svix_id:verified.id};
      const {error:updateError}=await admin.from("email_events").update({status,meta}).eq("id",row.id);
      if(updateError){await admin.from("webhook_receipts").delete().eq("svix_id",verified.id);return json({error:"Webhook processing unavailable"},500);}
    }
  }
  return json({ok:true,ignored:!row});
 }catch{return json({error:"Webhook processing unavailable"},500);}
});
function json(data:unknown,status=200):Response{return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
