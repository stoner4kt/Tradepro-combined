const encoder = new TextEncoder();

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Verify Resend's Svix v1 HMAC signature over id.timestamp.rawBody. */
export async function verifySvix(raw: string, headers: Headers, secret: string, nowMs = Date.now()): Promise<string | null> {
  const id = headers.get("svix-id") || "";
  const timestamp = headers.get("svix-timestamp") || "";
  const signatures = headers.get("svix-signature") || "";
  if (!secret.startsWith("whsec_") || !id || !timestamp || !signatures) return null;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowMs / 1000 - ts) > 300) return null;
  try {
    const keyBytes = Uint8Array.from(atob(secret.slice(6)), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signed = encoder.encode(`${id}.${timestamp}.${raw}`);
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
    const valid = signatures.split(" ").some(part => {
      const [version, value] = part.split(",", 2);
      if (version !== "v1" || !value) return false;
      try { return constantTimeEqual(expected, Uint8Array.from(atob(value), c => c.charCodeAt(0))); }
      catch { return false; }
    });
    return valid ? id : null;
  } catch {
    return null;
  }
}
