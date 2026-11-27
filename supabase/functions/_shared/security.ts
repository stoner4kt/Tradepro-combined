export function isUuid(value:string):boolean{return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
export function timingSafeEqual(a:string,b:string):boolean{
 const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);
 if(x.length!==y.length)return false;
 let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
export function requireIntegrationSecret(req:Request):boolean{
 const expected=Deno.env.get("INTEGRATION_SECRET")||"";
 const provided=req.headers.get("x-integration-secret")||"";
 return expected.length>=32 && timingSafeEqual(expected,provided);
}
export function clientIp(req:Request):string{
 return (req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||"unknown").split(",")[0].trim().slice(0,64);
}
