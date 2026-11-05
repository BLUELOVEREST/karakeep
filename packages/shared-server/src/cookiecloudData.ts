import { createDecipheriv, createHash } from "node:crypto";
import { z } from "zod";

import type { CookieCloudPlatform } from "@karakeep/shared/types/cookiecloud";

const payloadSchema = z.object({
  cookie_data: z.record(
    z.string(),
    z.array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string().optional(),
        hostOnly: z.boolean().optional(),
        expirationDate: z.number().optional(),
      }),
    ),
  ),
});

export function decryptCookieCloud(
  response: unknown,
  uuid: string,
  password: string,
) {
  const envelope = z
    .object({
      encrypted: z.string().min(1),
      crypto_type: z.string().default("legacy"),
    })
    .parse(response);
  const passphrase = createHash("md5")
    .update(`${uuid}-${password}`)
    .digest("hex")
    .slice(0, 16);
  let bytes = Buffer.from(envelope.encrypted, "base64");
  let key: Buffer;
  let iv: Buffer;
  let algorithm: string;
  if (envelope.crypto_type === "aes-128-cbc-fixed") {
    key = Buffer.from(passphrase);
    iv = Buffer.alloc(16);
    algorithm = "aes-128-cbc";
  } else if (envelope.crypto_type === "legacy") {
    // Current CookieCloud also offers CryptoJS's salted passphrase format.
    if (bytes.subarray(0, 8).toString() !== "Salted__" || bytes.length < 32)
      throw new Error("Invalid encrypted payload");
    const salt = bytes.subarray(8, 16);
    let material = Buffer.alloc(0);
    let previous = Buffer.alloc(0);
    while (material.length < 48) {
      previous = createHash("md5")
        .update(Buffer.concat([previous, Buffer.from(passphrase), salt]))
        .digest();
      material = Buffer.concat([material, previous]);
    }
    key = material.subarray(0, 32);
    iv = material.subarray(32, 48);
    bytes = bytes.subarray(16);
    algorithm = "aes-256-cbc";
  } else throw new Error("Unsupported CookieCloud encryption");
  const decipher = createDecipheriv(algorithm, key, iv);
  const plaintext = Buffer.concat([
    decipher.update(bytes),
    decipher.final(),
  ]).toString("utf8");
  return payloadSchema.parse(JSON.parse(plaintext));
}

export function extractPlatformCookie(
  payload: unknown,
  platform: CookieCloudPlatform,
  now = Date.now(),
): string | null {
  const { cookie_data } = payloadSchema.parse(payload);
  const root = platform === "xiaohongshu" ? "xiaohongshu.com" : "douyin.com";
  const host = `www.${root}`;
  const selected = new Map<string, { value: string; specificity: number }>();
  for (const [group, cookies] of Object.entries(cookie_data)) {
    const groupDomain = group.replace(/^\./, "").toLowerCase();
    if (groupDomain !== root && !groupDomain.endsWith(`.${root}`)) continue;
    for (const cookie of cookies) {
      const domain = cookie.domain.replace(/^\./, "").toLowerCase();
      if (domain !== root && domain !== host) continue;
      if (cookie.hostOnly && domain !== host) continue;
      if (cookie.path && cookie.path !== "/") continue;
      if (
        cookie.expirationDate !== undefined &&
        cookie.expirationDate <= now / 1000
      )
        continue;
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cookie.name) ||
        !cookie.value ||
        [...cookie.value].some(
          (char) =>
            char.charCodeAt(0) <= 32 ||
            char.charCodeAt(0) === 127 ||
            ";,".includes(char),
        )
      )
        continue;
      if ((selected.get(cookie.name)?.specificity ?? 0) > domain.length)
        continue;
      selected.set(cookie.name, {
        value: cookie.value,
        specificity: domain.length,
      });
    }
  }
  const header = [...selected]
    .map(([name, cookie]) => `${name}=${cookie.value}`)
    .join("; ");
  if (header.length > 20000)
    throw new Error("Platform cookie exceeds size limit");
  return header || null;
}
