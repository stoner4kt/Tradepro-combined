// Public invoice/quote share API. Tokens are unguessable bearer capabilities.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { adminClient } from "../_shared/invoicing/supabase.ts";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
function json(data:unknown,status=200):Response{return new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store","X-Robots-Tag":"noindex"}});}
async function digest(value:string):Promise<string>{
 const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,"0")).join("");
}
async function limit(admin:ReturnType<typeof adminClient>,req:Request,kind:string,max:number,windowSeconds:number):Promise<boolean>{
 const ip=(req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||"unknown").split(",")[0].slice(0,64);
 const key=await digest(`public-share:${kind}:${ip}`);
 const {data,error}=await admin.schema("public").rpc("rate_limit_hit",{p_key:key,p_window_seconds:windowSeconds,p_max:max});
 const row=Array.isArray(data)?data[0]:data;
 return !error && Boolean(row?.allowed);
}
serve(async(req:Request):Promise<Response>=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 const parts=new URL(req.url).pathname.split("/").filter(Boolean).slice(3);
 if(parts[0]!=="api"||(parts[1]!=="quote"&&parts[1]!=="invoice")||!parts[2])return json({error:"Not found"},404);
 const kind=parts[1],token=parts[2],action=parts[3]||"";
 if(req.method!=="GET"&&!(req.method==="POST"&&kind==="quote"&&action==="respond"))return json({error:"Method not allowed"},405);
 let admin;try{admin=adminClient();}catch{return json({error:"Service unavailable"},503);}
 if(!(await limit(admin,req,kind,req.method==="GET"?60:10,req.method==="GET"?60:3600))return json({error:"Too many requests"},429);
 const {data:doc,error}=await admin.from("documents").select("id,user_id,kind,number,status,customer_snapshot,issue_date,due_date,quote_valid_until,title,notes,currency,subtotal_minor,tax_minor,total_minor,amount_paid_minor,created_at,token,expires_at,meta").eq("token",token).maybeSingle();
 if(error||!doc||doc.kind!==kind||["void","declined","draft"].includes(doc.status)||(doc.expires_at&&Date.parse(doc.expires_at)<=Date.now()))return json({error:"This document is unavailable"},404);
 if(req.method==="POST"){
  let body:Record<string,unknown>;try{body=await req.json();}catch{return json({error:"Invalid request"},400);}
  const response=String(body.response||""),name=String(body.name||"").trim();
  if(!["accept","decline"].includes(response)||name.length<2||name.length>120)return json({error:"A valid response and typed name are required"},400);
  if(doc.status!=="sent")return json({error:"This quote can no longer be responded to"},409);
  const ip=(req.headers.get("cf-connecting-ip")||"unknown").slice(0,64);
  const meta={...(doc.meta||{}),customer_response:response,responded_by:name,responded_at:new Date().toISOString(),response_ip:ip};
  const {data:updated,error:updateError}=await admin.from("documents").update({status:response==="accept"?"accepted":"declined",meta,updated_at:new Date().toISOString()}).eq("id",doc.id).eq("user_id",doc.user_id).eq("status","sent").select("status").maybeSingle();
  if(updateError||!updated)return json({error:"This quote has already been responded to"},409);
  return json({ok:true,status:updated.status});
 }
 const {data:lines,error:lineError}=await admin.from("document_lines").select("description,quantity,unit_price_minor,sort_order").eq("document_id",doc.id).eq("user_id",doc.user_id).order("sort_order",{ascending:true});
 if(lineError)return json({error:"Unable to load document"},500);
 const {data:issuer}=await admin.from("settings").select("business_name,email,phone,business_address,tax_number,bank_details,notes,currency,locale").eq("user_id",doc.user_id).maybeSingle();
 return json({document:doc,lines:lines||[],issuer:issuer||{}});
});
