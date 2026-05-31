// Server-only encryption for partner credentials + 2FA backups.
//
// AES-256-GCM with the key derived from AUTH_SECRET (already configured in
// the environment, so there's nothing extra to set up). Ciphertext is stored
// as base64 of iv(12) | authTag(16) | ciphertext. Never store plaintext.

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set — cannot encrypt/decrypt onboarding credentials"
    );
  }
  // sha256 gives us a stable 32-byte key from whatever AUTH_SECRET is.
  return crypto.createHash("sha256").update(secret).digest();
}

/** Encrypt a secret. Returns null for empty input so we don't store noise. */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Decrypt a stored secret. Returns null for empty input, and a sentinel
 * string if the ciphertext can't be read (e.g. AUTH_SECRET rotated) so the
 * back office degrades visibly instead of throwing.
 */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (payload == null || payload === "") return null;
  try {
    const raw = Buffer.from(payload, "base64");
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return "⚠️ unable to decrypt";
  }
}
