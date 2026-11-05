import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { UserAIError } from "./errors";

export function readAIEncryptionKey(value?: string): Buffer {
  const encoded = value?.trim() ?? "";
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded)
    throw new UserAIError("ENCRYPTION_KEY_MISSING");
  return key;
}

export function encryptAIKey(
  value: string,
  context: string,
  masterKey?: string,
): string {
  const key = readAIEncryptionKey(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptAIKey(
  payload: string,
  context: string,
  masterKey?: string,
): string {
  const key = readAIEncryptionKey(masterKey);
  try {
    const [version, iv, tag, encrypted, extra] = payload.split(":");
    if (version !== "v1" || !iv || !tag || !encrypted || extra !== undefined)
      throw new Error("Invalid payload");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64"),
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new UserAIError("DECRYPTION_FAILED");
  }
}
