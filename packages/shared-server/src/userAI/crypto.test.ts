import { describe, expect, it } from "vitest";

import { decryptAIKey, encryptAIKey, readAIEncryptionKey } from "./crypto";

describe("personal AI key encryption", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  it("uses authenticated randomized encryption bound to owner and connection", () => {
    const secret = "private-api-key";
    const encrypted = encryptAIKey(secret, "owner:https://api.example/v1", key);
    expect(encrypted).not.toContain(secret);
    expect(encrypted).not.toBe(
      encryptAIKey(secret, "owner:https://api.example/v1", key),
    );
    expect(decryptAIKey(encrypted, "owner:https://api.example/v1", key)).toBe(
      secret,
    );
    expect(() =>
      decryptAIKey(encrypted, "other:https://api.example/v1", key),
    ).toThrow("DECRYPTION_FAILED");
    expect(() =>
      decryptAIKey(encrypted, "owner:https://elsewhere.example/v1", key),
    ).toThrow("DECRYPTION_FAILED");
  });
  it("fails closed without a valid independent master key", () => {
    for (const value of [
      undefined,
      "",
      "password",
      Buffer.alloc(16).toString("base64"),
    ]) {
      expect(() => readAIEncryptionKey(value)).toThrow(
        "ENCRYPTION_KEY_MISSING",
      );
    }
  });
  it("rejects corruption and key rotation without exposing payloads", () => {
    const encrypted = encryptAIKey("private-api-key", "owner", key);
    expect(() =>
      decryptAIKey(encrypted, "owner", Buffer.alloc(32, 8).toString("base64")),
    ).toThrow("DECRYPTION_FAILED");
    expect(() =>
      decryptAIKey("secret-corrupted-payload", "owner", key),
    ).toThrow("DECRYPTION_FAILED");
  });
});
