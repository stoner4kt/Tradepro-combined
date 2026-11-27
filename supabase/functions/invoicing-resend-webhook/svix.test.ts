import { verifySvix } from "../_shared/svix.ts";

async function signature(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secret.slice(6)), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  return btoa(String.fromCharCode(...signed));
}

Deno.test("accepts a valid Svix v1 signature and multiple signature candidates", async () => {
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = "whsec_" + btoa(String.fromCharCode(...secretBytes));
  const id = "msg_test_123";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = '{"type":"email.delivered","data":{"email_id":"email_123"}}';
  const valid = await signature(secret, id, timestamp, body);
  const headers = new Headers({
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,AAAA v1,${valid}`,
  });
  if (await verifySvix(body, headers, secret) !== id) throw new Error("valid signature was rejected");
});

Deno.test("rejects invalid body, stale timestamp and wrong secret", async () => {
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = "whsec_" + btoa(String.fromCharCode(...secretBytes));
  const id = "msg_test_456";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = '{"type":"email.bounced"}';
  const valid = await signature(secret, id, timestamp, body);
  const headers = new Headers({ "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${valid}` });
  if (await verifySvix(body + " ", headers, secret) !== null) throw new Error("tampered body was accepted");
  if (await verifySvix(body, headers, secret, Date.now() + 301_000) !== null) throw new Error("stale signature was accepted");
  if (await verifySvix(body, headers, "whsec_wrong") !== null) throw new Error("wrong secret was accepted");
});
