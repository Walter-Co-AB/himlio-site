// Signed links in booking emails (confirm, cancel) and the secret feed address. HMAC-SHA-256
// with a per-site random key the plugin keeps in its KV; nothing in git or the build.

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A new random secret: 32 bytes, base64url. */
export function newSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/** The signature of `purpose:value`, base64url (purposes keep a cancel token from confirming). */
export async function sign(secret: string, purpose: string, value: string): Promise<string> {
  const mac = await crypto.subtle.sign(
    'HMAC',
    await key(secret),
    encoder.encode(`${purpose}:${value}`)
  );
  return base64url(new Uint8Array(mac));
}

/** Whether `signature` is the signature of `purpose:value`, compared in constant time. */
export async function verify(
  secret: string,
  purpose: string,
  value: string,
  signature: string
): Promise<boolean> {
  const expected = await sign(secret, purpose, value);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
