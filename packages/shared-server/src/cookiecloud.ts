import { eq } from "drizzle-orm";
import cron from "node-cron";
import { TRPCError } from "@trpc/server";

import type { DB } from "@karakeep/db";
import { config } from "@karakeep/db/schema";
import { zCookieCloudSettings } from "@karakeep/shared/types/cookiecloud";
import type {
  CookieCloudResult,
  CookieCloudSettings,
} from "@karakeep/shared/types/cookiecloud";

import { decryptCookieCloud, extractPlatformCookie } from "./cookiecloudData";
import {
  resolverConfigTarget,
  withResolverSettingsLock,
  writeResolverSecret,
} from "./resolverSecrets";

const SETTINGS_KEY = "cookiecloud-settings";
const RESULT_KEY = "cookiecloud-result";
export const COOKIECLOUD_SLOT_KEY = "cookiecloud-scheduled-slot";

export class CookieCloud {
  constructor(private readonly db: DB) {}

  async settings(): Promise<CookieCloudSettings> {
    const row = await this.db.query.config.findFirst({
      where: eq(config.key, SETTINGS_KEY),
    });
    return row
      ? zCookieCloudSettings.parse(JSON.parse(row.value))
      : {
          enabled: false,
          url: "",
          uuid: "",
          cron: "0 */6 * * *",
          timezone: "Asia/Shanghai",
        };
  }

  async status() {
    const settings = await this.settings();
    const row = await this.db.query.config.findFirst({
      where: eq(config.key, RESULT_KEY),
    });
    const { password, ...safe } = settings;
    return {
      ...safe,
      passwordConfigured: !!password,
      lastResult: row ? (JSON.parse(row.value) as CookieCloudResult) : null,
    };
  }

  async save(input: CookieCloudSettings) {
    return withResolverSettingsLock(this.db, async () => {
      const previous = await this.settings();
      const next = zCookieCloudSettings.parse({
        ...input,
        password: input.password ?? previous.password,
      });
      if (next.cron.split(/\s+/).length !== 5 || !cron.validate(next.cron))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter a valid five-field cron expression",
        });
      if (next.enabled && (!next.url || !next.uuid || !next.password))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "CookieCloud URL, UUID and password are required",
        });
      this.put(SETTINGS_KEY, next);
      this.db.delete(config).where(eq(config.key, COOKIECLOUD_SLOT_KEY)).run();
      return this.status();
    });
  }

  private put(key: string, value: unknown) {
    const encoded = JSON.stringify(value);
    this.db
      .insert(config)
      .values({ key, value: encoded })
      .onConflictDoUpdate({ target: config.key, set: { value: encoded } })
      .run();
  }

  async sync(
    scheduledSlot?: string,
    scheduleSignature?: string,
  ): Promise<CookieCloudResult | null> {
    return withResolverSettingsLock(this.db, async () => {
      const settings = await this.settings();
      if (scheduledSlot) {
        if (!settings.enabled) return null;
        if (
          scheduleSignature &&
          scheduleSignature !==
            JSON.stringify([settings.enabled, settings.cron, settings.timezone])
        )
          return null;
        const previous = await this.db.query.config.findFirst({
          where: eq(config.key, COOKIECLOUD_SLOT_KEY),
        });
        if (previous?.value === scheduledSlot) return null;
      }
      if (!settings.url || !settings.uuid || !settings.password)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Configure CookieCloud URL, UUID and password first",
        });
      if (scheduledSlot)
        this.db
          .insert(config)
          .values({ key: COOKIECLOUD_SLOT_KEY, value: scheduledSlot })
          .onConflictDoUpdate({
            target: config.key,
            set: { value: scheduledSlot },
          })
          .run();
      const result: CookieCloudResult = {
        attemptedAt: new Date().toISOString(),
        platforms: { xiaohongshu: "missing", douyin: "missing" },
        error: null,
      };
      try {
        const url = new URL(
          `${settings.url.replace(/\/+$/, "")}/get/${encodeURIComponent(settings.uuid)}`,
        );
        const response = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("download");
        }
        // Bound memory usage even if a server omits Content-Length.
        if (!response.body) throw new Error("empty");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) throw new Error("size");
          chunks.push(chunk);
        }
        const payload = decryptCookieCloud(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
          settings.uuid,
          settings.password,
        );
        for (const resolverId of ["xiaohongshu", "douyin"] as const) {
          try {
            const value = extractPlatformCookie(payload, resolverId);
            if (!value) continue;
            if (!resolverConfigTarget(resolverId)) {
              result.platforms[resolverId] = "unavailable";
              continue;
            }
            await writeResolverSecret(this.db, {
              resolverId,
              key: resolverId === "xiaohongshu" ? "xhsCookie" : "douyinCookie",
              value,
              source: "cookiecloud",
              updatedBy: null,
            });
            result.platforms[resolverId] = "updated";
          } catch (error) {
            result.platforms[resolverId] = "failed";
            const message =
              error instanceof TRPCError
                ? error.message
                : "Invalid platform Cookie data";
            result.error = [result.error, `${resolverId}: ${message}`]
              .filter(Boolean)
              .join("; ");
          }
        }
      } catch {
        result.error =
          "CookieCloud download or decryption failed. Check the server, UUID, password and encryption format.";
        result.platforms = { xiaohongshu: "failed", douyin: "failed" };
      }
      this.put(RESULT_KEY, result);
      return result;
    });
  }
}
