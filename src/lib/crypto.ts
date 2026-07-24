import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM with a random IV per value. Stored format:
// base64(iv).base64(authTag).base64(ciphertext)

function encryptionKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes of hex (openssl rand -hex 32)",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((b) => b.toString("base64"))
    .join(".");
}

export function decryptSecret(stored: string): string {
  const [iv, authTag, ciphertext] = stored
    .split(".")
    .map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
