import { createCipheriv, createHash } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DB } from "@karakeep/db";
import * as schema from "@karakeep/db/schema";

import { CookieCloud } from "./cookiecloud";
import {
  withResolverSettingsLock,
  writeResolverSecret,
} from "./resolverSecrets";

vi.mock("@karakeep/shared/config", () => ({
  default: {
    crawler: {
      xiaohongshuSpiderEndpoint: "http://xhs.test/article",
      douyinResolverEndpoint: "http://douyin.test/article",
    },
  },
}));

let sqlite: InstanceType<typeof Database>;
let db: DB;
let service: CookieCloud;
const settings = {
  enabled: true,
  url: "https://cloud.test/prefix",
  uuid: "uuid",
  password: "password",
  cron: "0 */6 * * *",
  timezone: "Asia/Shanghai",
};

function envelope() {
  const key = createHash("md5")
    .update("uuid-password")
    .digest("hex")
    .slice(0, 16);
  const cipher = createCipheriv(
    "aes-128-cbc",
    Buffer.from(key),
    Buffer.alloc(16),
  );
  const data = {
    cookie_data: {
      "xiaohongshu.com": [
        { name: "a1", value: "cloud", domain: ".xiaohongshu.com" },
      ],
    },
  };
  return {
    crypto_type: "aes-128-cbc-fixed",
    encrypted: Buffer.concat([
      cipher.update(JSON.stringify(data)),
      cipher.final(),
    ]).toString("base64"),
  };
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(
    "CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE resolverRuntimeConfig (resolverId TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, createdAt INTEGER, modifiedAt INTEGER, updatedBy TEXT, PRIMARY KEY (resolverId, key));",
  );
  db = drizzle(sqlite, { schema }) as DB;
  service = new CookieCloud(db);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, options?: RequestInit) => {
      if (options?.method === "PUT") return new Response("{}");
      expect(url.toString()).toBe("https://cloud.test/prefix/get/uuid");
      expect(options).not.toHaveProperty("body");
      return Response.json(envelope());
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  sqlite.close();
});

describe("CookieCloud synchronization", () => {
  it("masks the password and retains it when saving other settings", async () => {
    await service.save(settings);
    expect(await service.status()).not.toHaveProperty("password");
    await service.save({ ...settings, password: undefined, cron: "0 0 * * *" });
    expect((await service.settings()).password).toBe("password");
  });
  it("rejects invalid cron and incomplete enabled configurations", async () => {
    for (const cron of ["* * * * * *", "0 24 * * *", "invalid"])
      await expect(service.save({ ...settings, cron })).rejects.toThrow();
    await expect(
      service.save({ ...settings, password: undefined }),
    ).rejects.toThrow();
    expect((await service.settings()).enabled).toBe(false);
  });
  it("overwrites manual cookies on every successful sync, even when cloud data is unchanged", async () => {
    await service.save(settings);
    expect((await service.sync())?.platforms).toEqual({
      xiaohongshu: "updated",
      douyin: "missing",
    });
    await withResolverSettingsLock(db, () =>
      writeResolverSecret(db, {
        resolverId: "xiaohongshu",
        key: "xhsCookie",
        value: "a1=manual",
        source: "manual",
        updatedBy: null,
      }),
    );
    expect((await db.query.resolverRuntimeConfigs.findFirst())?.value).toBe(
      "a1=manual",
    );
    await service.sync();
    expect((await db.query.resolverRuntimeConfigs.findFirst())?.value).toBe(
      "a1=cloud",
    );
  });
  it("preserves the last cookie on download and resolver dispatch errors", async () => {
    await service.save(settings);
    await service.sync();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("secret diagnostic must not escape");
      }),
    );
    expect((await service.sync())?.error).not.toContain("secret diagnostic");
    expect((await db.query.resolverRuntimeConfigs.findFirst())?.value).toBe(
      "a1=cloud",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, options?: RequestInit) =>
        options?.method === "PUT"
          ? new Response("secret", { status: 500 })
          : Response.json(envelope()),
      ),
    );
    expect((await service.sync())?.platforms.xiaohongshu).toBe("failed");
    expect((await db.query.resolverRuntimeConfigs.findFirst())?.value).toBe(
      "a1=cloud",
    );
  });
  it("deduplicates scheduled slots and stops scheduled sync when disabled", async () => {
    await service.save(settings);
    await service.sync("slot");
    expect(await service.sync("slot")).toBeNull();
    await service.save({ ...settings, enabled: false });
    expect(await service.sync("next")).toBeNull();
  });
  it("ignores callbacks from a schedule that has just been replaced", async () => {
    await service.save(settings);
    const oldSignature = JSON.stringify([
      true,
      settings.cron,
      settings.timezone,
    ]);
    await service.save({ ...settings, cron: "0 0 * * *" });
    expect(await service.sync("old-slot", oldSignature)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not remove an existing cookie when the cloud lacks that platform", async () => {
    await service.save(settings);
    await withResolverSettingsLock(db, () =>
      writeResolverSecret(db, {
        resolverId: "douyin",
        key: "douyinCookie",
        value: "sessionid=manual",
        source: "manual",
        updatedBy: null,
      }),
    );
    await service.sync();
    expect(
      (await db.query.resolverRuntimeConfigs.findMany()).find(
        (row) => row.resolverId === "douyin",
      )?.value,
    ).toBe("sessionid=manual");
  });
  it("excludes simultaneous manual and automatic updates and releases locks after errors", async () => {
    await withResolverSettingsLock(db, async () => {
      await expect(
        withResolverSettingsLock(db, async () => null),
      ).rejects.toThrow("being updated");
    });
    await expect(
      withResolverSettingsLock(db, async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect(await withResolverSettingsLock(db, async () => "released")).toBe(
      "released",
    );
  });
});
