import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import type { DB } from "@karakeep/db";
import { config, resolverRuntimeConfigs } from "@karakeep/db/schema";
import serverConfig from "@karakeep/shared/config";
import type {
  ResolverId,
  ResolverSecretKey,
} from "@karakeep/shared/types/resolverSettings";

export const resolverSourceKey = (id: ResolverId) =>
  `resolver-secret-source:${id}`;

export async function withResolverSettingsLock<T>(
  db: DB,
  action: () => Promise<T>,
): Promise<T> {
  const key = "resolver-settings-lock";
  const token = `${Date.now() + 120000}:${randomUUID()}`;
  const acquired = db
    .insert(config)
    .values({ key, value: token })
    .onConflictDoUpdate({
      target: config.key,
      set: { value: token },
      setWhere: sql`cast(${config.value} as integer) < ${Date.now()}`,
    })
    .run();
  if (!acquired.changes)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Resolver settings are being updated. Try again shortly.",
    });
  try {
    return await action();
  } finally {
    db.delete(config)
      .where(and(eq(config.key, key), eq(config.value, token)))
      .run();
  }
}

export function resolverConfigTarget(resolverId: ResolverId): URL | null {
  const endpoint =
    resolverId === "xiaohongshu"
      ? serverConfig.crawler.xiaohongshuSpiderEndpoint
      : resolverId === "douyin"
        ? serverConfig.crawler.douyinResolverEndpoint
        : null;
  return endpoint ? new URL("/api/karakeep/v1/config", endpoint) : null;
}

// The caller holds the shared lease across dispatch and persistence.
export async function writeResolverSecret(
  db: DB,
  input: {
    resolverId: ResolverId;
    key: ResolverSecretKey;
    value: string | null;
    updatedBy: string | null;
    source: "manual" | "cookiecloud";
  },
) {
  const expected = {
    xiaohongshu: "xhsCookie",
    douyin: "douyinCookie",
    wechat: "wechatArticleAuthKey",
  };
  if (expected[input.resolverId] !== input.key)
    throw new Error("Invalid resolver secret key");
  const target = resolverConfigTarget(input.resolverId);
  if (target) {
    let response: Response;
    try {
      response = await fetch(target, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [input.key]: input.value }),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch {
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: `Failed to reach ${input.resolverId} resolver config API`,
      });
    }
    if (!response.ok)
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: `${input.resolverId} resolver config API returned HTTP ${response.status}`,
      });
    await response.body?.cancel();
  }
  db.transaction((tx) => {
    if (input.value === null) {
      tx.delete(resolverRuntimeConfigs)
        .where(
          and(
            eq(resolverRuntimeConfigs.resolverId, input.resolverId),
            eq(resolverRuntimeConfigs.key, input.key),
          ),
        )
        .run();
      tx.delete(config)
        .where(eq(config.key, resolverSourceKey(input.resolverId)))
        .run();
    } else {
      const value = input.value.trim();
      tx.insert(resolverRuntimeConfigs)
        .values({
          resolverId: input.resolverId,
          key: input.key,
          value,
          updatedBy: input.updatedBy,
        })
        .onConflictDoUpdate({
          target: [
            resolverRuntimeConfigs.resolverId,
            resolverRuntimeConfigs.key,
          ],
          set: { value, updatedBy: input.updatedBy, modifiedAt: new Date() },
        })
        .run();
      tx.insert(config)
        .values({
          key: resolverSourceKey(input.resolverId),
          value: input.source,
        })
        .onConflictDoUpdate({
          target: config.key,
          set: { value: input.source },
        })
        .run();
    }
  });
}
