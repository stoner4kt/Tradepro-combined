import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import { clientIp } from "../_shared/security.ts";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, authorization, x-widget-key","Access-Control-Allow-Methods":"POST, OPTIONS"};
function json(data:unknown,status=200):Response{return new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});}
function adminClient():SupabaseClient{
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)throw new Error("Service unavailable");
 return createClient(url,key,{db:{schema:"reviewflow"}});
}
function escapeHtml(value:string):string{return value.replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]||ch));}
async function hash(value:string):Promise<string>{
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
interface WidgetOwner{user_id:string;widget_api_key:string;}
serve(async(req:Request):Promise<Response>=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const widgetKey=req.headers.get("x-widget-key")||"";
 const origin=req.headers.get("origin")||"";
 if(!widgetKey||widgetKey.length>256||!origin)return json({error:"Invalid widget request"},401);
 let body:Record<string,unknown>;
 try{body=await req.json();}catch{return json({error:"Invalid request"},400);}
 const email=String(body.email||"").trim().toLowerCase();
 const first=String(body.first_name||""),last=String(body.last_name||"");
 const phone=String(body.phone||""),service=String(body.service||""),message=String(body.message||"");
 if(body.website || body.consent!==true || !Number.isFinite(Number(body.started_at)) || Date.now()-Number(body.started_at)<1200)
  return json({error:"Invalid submission"},400);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||first.length>120||last.length>120||phone.length>40||service.length>120||message.length>2000)
  return json({error:"Invalid submission"},400);
 let admin:SupabaseClient;
 try{admin=adminClient();}catch{return json({error:"Service unavailable"},503);}
 const {data:owner,error:ownerError}=await admin.from("settings").select("user_id,widget_api_key").eq("widget_api_key",widgetKey).maybeSingle();
 if(ownerError||!owner)return json({error:"Invalid widget request"},401);
 const publicDb=admin.schema("public");
 const {data:ownerSettings,error:settingsError}=await publicDb.from("settings").select("allowed_origins").eq("user_id",owner.user_id).maybeSingle();
 const origins=Array.isArray(ownerSettings?.allowed_origins)?ownerSettings.allowed_origins as string[]:[];
 if(settingsError||!origins.includes(origin))return json({error:"Origin not allowed"},403);
 const ip=clientIp(req);
 const [perIpKey,perDayKey]=await Promise.all([hash(`capture:${owner.user_id}:${widgetKey}:${ip}`),hash(`capture-day:${owner.user_id}:${widgetKey}`)]);
 const [shortLimit,dayLimit]=await Promise.all([
  publicDb.rpc("rate_limit_hit",{p_key:perIpKey,p_window_seconds:600,p_max:30}),
  publicDb.rpc("rate_limit_hit",{p_key:perDayKey,p_window_seconds:86400,p_max:300}),
 ]);
 const shortRow=Array.isArray(shortLimit.data)?shortLimit.data[0]:shortLimit.data;
 const dayRow=Array.isArray(dayLimit.data)?dayLimit.data[0]:dayLimit.data;
 if(shortLimit.error||dayLimit.error)return json({error:"Rate limit service unavailable"},503);
 if(!shortRow?.allowed||!dayRow?.allowed)return json({error:"Too many submissions. Please try again later."},429);
 const {data:existing}=await admin.from("leads").select("id").eq("user_id",owner.user_id).eq("email",email).gte("created_at",new Date(Date.now()-10*60*1000).toISOString()).limit(1).maybeSingle();
 if(existing)return json({success:true,lead_id:existing.id});
 const {data:lead,error}=await admin.from("leads").insert({
  user_id:owner.user_id,first_name:first,last_name:last,email,phone:phone||null,service:service||null,message:message||null,
  source:"widget",status:"new",consent_at:new Date().toISOString(),consent_text:"I agree to be contacted about this enquiry.",source_url:origin
 }).select("id").single();
 if(error)return json({error:"Unable to save your enquiry"},500);

 // Acknowledgement is best-effort, capped per owner, and suppressed for opted-out recipients.
 const {data:optOut,error:optOutError}=await publicDb.from("email_opt_outs").select("id").eq("user_id",owner.user_id).eq("email",email).maybeSingle();
 const resendKey=Deno.env.get("RESEND_API_KEY")||"",from=Deno.env.get("RESEND_FROM_EMAIL")||"",replyTo=Deno.env.get("RESEND_REPLY_TO")||"";
 if(!optOutError&&!optOut&&resendKey&&from){
  const {data:capSettings}=await publicDb.from("settings").select("daily_email_cap").eq("user_id",owner.user_id).maybeSingle();
  const cap=Math.max(1,Math.min(500,Number(capSettings?.daily_email_cap||50)));
  const ackKey=await hash("capture-ack:"+owner.user_id);
  const {data:capData,error:capError}=await publicDb.rpc("rate_limit_hit",{p_key:ackKey,p_window_seconds:86400,p_max:cap});
  const capRow=Array.isArray(capData)?capData[0]:capData;
  if(!capError&&capRow?.allowed){
   const raw=crypto.getRandomValues(new Uint8Array(32));
   const unsubscribeToken=Array.from(raw,b=>b.toString(16).padStart(2,"0")).join("");
   const unsubscribeHash=await hash(unsubscribeToken);
   const {error:tokenError}=await publicDb.from("email_opt_out_tokens").insert({user_id:owner.user_id,email,token_hash:unsubscribeHash,expires_at:new Date(Date.now()+180*86400000).toISOString()});
   if(!tokenError){
    const unsubscribeUrl=(Deno.env.get("SUPABASE_URL")||"").replace(/\/+$/,"")+"/functions/v1/reviewflow-unsubscribe?token="+encodeURIComponent(unsubscribeToken);
    const html="<p>Thank you for contacting us. We have received your enquiry and will be in touch.</p><p><strong>Service:</strong> "+escapeHtml(service)+"</p><p><strong>Message:</strong> "+escapeHtml(message)+"</p><p><a href=\""+escapeHtml(unsubscribeUrl)+"\">Unsubscribe from review-request emails</a></p>";
    try{await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+resendKey,"Content-Type":"application/json","Idempotency-Key":"tradepro-capture-ack-"+lead.id,"List-Unsubscribe":"<"+unsubscribeUrl+">","List-Unsubscribe-Post":"List-Unsubscribe=One-Click"},body:JSON.stringify({from,to:[email],subject:"We received your enquiry",html,reply_to:replyTo||undefined})});}catch{/* The lead is saved even if acknowledgement delivery fails. */}
   }
  }
 }
 return json({success:true,lead_id:lead.id});
});
