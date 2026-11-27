import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const html=(title:string,body:string,status=200)=>new Response("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>"+title+"</title><body style=\"font:16px system-ui;max-width:40rem;margin:4rem auto;padding:1rem;color:#172033\"><h1>"+title+"</h1><p>"+body+"</p></body></html>",{status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
serve(async(req:Request):Promise<Response>=>{
 if(req.method!=="GET")return html("Method not allowed","Please use the unsubscribe link in your email.",405);
 const token=new URL(req.url).searchParams.get("token")||"";
 if(token.length<32||token.length>256)return html("Invalid link","This unsubscribe link is invalid or has expired.",400);
 const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!url||!key)return html("Unavailable","Please try again later.",503);
 const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 const tokenHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
 const {data:row,error}=await admin.from("email_opt_out_tokens").select("id,user_id,email,expires_at,used_at").eq("token_hash",tokenHash).maybeSingle();
 if(error||!row||row.used_at||Date.parse(row.expires_at)<=Date.now())return html("Link expired","This unsubscribe link is invalid or has already been used.",400);
 const {data:existing,error:lookupError}=await admin.from("email_opt_outs").select("id").eq("user_id",row.user_id).eq("email",String(row.email).toLowerCase()).maybeSingle();
 if(lookupError)return html("Unable to unsubscribe","Please try again later.",503);
 if(!existing){const {error:insertError}=await admin.from("email_opt_outs").insert({user_id:row.user_id,email:String(row.email).toLowerCase()});if(insertError&&insertError.code!=="23505")return html("Unable to unsubscribe","Please contact the business directly.",503);}
 await admin.from("email_opt_out_tokens").update({used_at:new Date().toISOString()}).eq("id",row.id).is("used_at",null);
 return html("Unsubscribed","You will no longer receive automated review-request emails from this business.");
});
