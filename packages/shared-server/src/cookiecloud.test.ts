import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptCookieCloud, extractPlatformCookie } from "./cookiecloudData";

function encrypted(payload: unknown) {
  const key = createHash("md5")
    .update("uuid-password")
    .digest("hex")
    .slice(0, 16);
  const cipher = createCipheriv(
    "aes-128-cbc",
    Buffer.from(key),
    Buffer.alloc(16),
  );
  return {
    crypto_type: "aes-128-cbc-fixed",
    encrypted: Buffer.concat([
      cipher.update(JSON.stringify(payload)),
      cipher.final(),
    ]).toString("base64"),
  };
}

describe("CookieCloud data", () => {
  it("decrypts the current fixed-IV protocol locally", () => {
    const payload = { cookie_data: { ".xiaohongshu.com": [] } };
    expect(decryptCookieCloud(encrypted(payload), "uuid", "password")).toEqual(
      payload,
    );
  });
  it("rejects wrong passwords and unsupported encryption", () => {
    expect(() =>
      decryptCookieCloud(encrypted({ cookie_data: {} }), "uuid", "wrong"),
    ).toThrow();
    expect(() =>
      decryptCookieCloud(
        { encrypted: "x", crypto_type: "unknown" },
        "uuid",
        "password",
      ),
    ).toThrow();
  });
  it("filters unrelated domains, subdomain-only, expired and unsafe cookies", () => {
    const payload = {
      cookie_data: {
        ".xiaohongshu.com": [
          { name: "a1", value: "good", domain: ".xiaohongshu.com", path: "/" },
          {
            name: "old",
            value: "old",
            domain: ".xiaohongshu.com",
            expirationDate: 1,
          },
          { name: "bad", value: "x; injected=y", domain: ".xiaohongshu.com" },
          { name: "other", value: "x", domain: ".evil.com" },
          {
            name: "sub",
            value: "x",
            domain: "other.xiaohongshu.com",
            hostOnly: true,
          },
        ],
        "evilxiaohongshu.com": [
          { name: "a1", value: "evil", domain: "evilxiaohongshu.com" },
        ],
      },
    };
    expect(extractPlatformCookie(payload, "xiaohongshu")).toBe("a1=good");
    expect(extractPlatformCookie(payload, "douyin")).toBeNull();
  });
  it("selects cookies applicable to the platform website without duplicate names", () => {
    expect(
      extractPlatformCookie(
        {
          cookie_data: {
            "douyin.com": [
              { name: "sessionid", value: "first", domain: ".douyin.com" },
              { name: "sessionid", value: "second", domain: "www.douyin.com" },
            ],
          },
        },
        "douyin",
      ),
    ).toBe("sessionid=second");
  });
});
