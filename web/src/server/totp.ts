import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Two-step sign-in with an authenticator app: TOTP (RFC 6238), the six-digit,
// 30-second codes that Google Authenticator, 1Password, Authy and the rest
// make. Built on node:crypto, no library. The shared secret is encrypted
// before it reaches the database (AES-256-GCM with AUTH_ENCRYPTION_KEY), so a
// database dump alone cannot make codes. Nothing here touches the database;
// accounts.ts stores what this makes.

const STEP_SECONDS = 30;
/** One step either side, for a phone clock that is a little off. */
const DRIFT = 1;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const ISSUER = "Sectionary";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32, the form authenticator apps take. */
export const newSecret = () => base32Encode(randomBytes(20));

export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

/** The six-digit code for one 30-second step (RFC 4226 dynamic truncation). */
export function codeFor(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const n = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * The step a code belongs to, or null. A step at or before `lastStep` is
 * refused, so a code that was already used (or an older one) cannot sign in again.
 */
export function matchStep(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const given = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const current = stepAt(now);
  for (let step = current - DRIFT; step <= current + DRIFT; step++) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = codeFor(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return step;
  }
  return null;
}

/** The otpauth:// link an authenticator app reads from the QR code. */
export function otpauthUrl(secret: string, email: string): string {
  const label = encodeURIComponent(`${ISSUER}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// ---------------------------------------------------------------- the secret at rest

export class TwoStepError extends Error {}

function key(): Buffer {
  const raw = process.env.AUTH_ENCRYPTION_KEY?.trim();
  if (!raw) throw new TwoStepError("Two-step sign-in is not configured yet (AUTH_ENCRYPTION_KEY).");
  // Any length of key text works: it is hashed to the 32 bytes AES-256 needs.
  return createHash("sha256").update(raw).digest();
}

export const twoStepConfigured = () => Boolean(process.env.AUTH_ENCRYPTION_KEY?.trim());

/** "v1.<iv>.<tag>.<ciphertext>", base64url. */
export function sealSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function openSecret(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new TwoStepError("Stored two-step secret is unreadable.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------- recovery codes

export const RECOVERY_COUNT = 10;

/** Ten codes like "k7q2-m9xd-4hpw", for when the phone is lost. Shown once. */
export function newRecoveryCodes(): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const bytes = randomBytes(12);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  });
}

export const normaliseRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
export const hashRecovery = (code: string) => createHash("sha256").update(normaliseRecovery(code)).digest("hex");
