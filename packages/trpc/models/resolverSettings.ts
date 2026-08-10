import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { resolverRuntimeConfigs } from "@karakeep/db/schema";
import serverConfig from "@karakeep/shared/config";
import type {
  ResolverId,
  ResolverRuntimeSettings,
  ResolverSecretKey,
} from "@karakeep/shared/types/resolverSettings";

import type { AuthedContext } from "../index";

const SETTINGS = [
  {
    resolverId: "xiaohongshu",
    key: "xhsCookie",
    envConfigured: () => false,
  },
  {
    resolverId: "douyin",
    key: "douyinCookie",
    envConfigured: () => false,
  },
  {
    resolverId: "wechat",
    key: "wechatArticleAuthKey",
    envConfigured: () => !!serverConfig.crawler.wechatArticleAuthKey,
  },
] as const;

export class ResolverSettings {
  constructor(private readonly ctx: AuthedContext) {}

  async getStatus(): Promise<ResolverRuntimeSettings> {
    const rows = await this.ctx.db.query.resolverRuntimeConfigs.findMany();

    const findRuntime = (resolverId: ResolverId, key: ResolverSecretKey) =>
      rows.find((row) => row.resolverId === resolverId && row.key === key);

    const status = Object.fromEntries(
      SETTINGS.map((setting) => {
        const runtime = findRuntime(setting.resolverId, setting.key);
        return [
          `${setting.resolverId}:${setting.key}`,
          {
            resolverId: setting.resolverId,
            key: setting.key,
            configured: !!runtime || setting.envConfigured(),
            source: runtime
              ? ("runtime" as const)
              : setting.envConfigured()
                ? ("environment" as const)
                : ("unset" as const),
            modifiedAt: runtime?.modifiedAt ?? null,
          },
        ];
      }),
    );

    return {
      xiaohongshu: {
        xhsCookie: status["xiaohongshu:xhsCookie"],
      },
      douyin: {
        douyinCookie: status["douyin:douyinCookie"],
      },
      wechat: {
        wechatArticleAuthKey: status["wechat:wechatArticleAuthKey"],
      },
    } as ResolverRuntimeSettings;
  }

  async getRuntimeValues() {
    const rows = await this.ctx.db.query.resolverRuntimeConfigs.findMany();
    const value = (resolverId: ResolverId, key: ResolverSecretKey) =>
      rows.find((row) => row.resolverId === resolverId && row.key === key)
        ?.value;

    return {
      xhsCookie: value("xiaohongshu", "xhsCookie"),
      douyinCookie: value("douyin", "douyinCookie"),
      wechatArticleAuthKey: value("wechat", "wechatArticleAuthKey"),
    };
  }

  async update(input: {
    resolverId: ResolverId;
    key: ResolverSecretKey;
    value: string;
  }) {
    const value = input.value.trim();
    assertValidResolverSecretKey(input.resolverId, input.key);
    await syncResolverRuntimeSecret(input.resolverId, input.key, value);
    await this.ctx.db
      .insert(resolverRuntimeConfigs)
      .values({
        resolverId: input.resolverId,
        key: input.key,
        value,
        updatedBy: this.ctx.user.id,
      })
      .onConflictDoUpdate({
        target: [resolverRuntimeConfigs.resolverId, resolverRuntimeConfigs.key],
        set: {
          value,
          updatedBy: this.ctx.user.id,
          modifiedAt: new Date(),
        },
      });
  }

  async clear(input: { resolverId: ResolverId; key: ResolverSecretKey }) {
    assertValidResolverSecretKey(input.resolverId, input.key);
    await syncResolverRuntimeSecret(input.resolverId, input.key, null);
    await this.ctx.db
      .delete(resolverRuntimeConfigs)
      .where(
        and(
          eq(resolverRuntimeConfigs.resolverId, input.resolverId),
          eq(resolverRuntimeConfigs.key, input.key),
        ),
      );
  }
}

async function syncResolverRuntimeSecret(
  resolverId: ResolverId,
  key: ResolverSecretKey,
  value: string | null,
) {
  const target = getResolverConfigSyncTarget(resolverId);
  if (!target) {
    return;
  }

  const response = await fetch(target, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  }).catch((error: unknown) => {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `Failed to reach ${resolverId} resolver config API: ${error instanceof Error ? error.message : String(error)}`,
    });
  });

  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `${resolverId} resolver config API returned HTTP ${response.status}`,
    });
  }
}

function getResolverConfigSyncTarget(resolverId: ResolverId): URL | null {
  if (resolverId === "xiaohongshu") {
    const endpoint = serverConfig.crawler.xiaohongshuSpiderEndpoint;
    return endpoint ? new URL("/api/karakeep/v1/config", endpoint) : null;
  }

  if (resolverId === "douyin") {
    const endpoint = serverConfig.crawler.douyinResolverEndpoint;
    return endpoint ? new URL("/api/karakeep/v1/config", endpoint) : null;
  }

  return null;
}

function assertValidResolverSecretKey(
  resolverId: ResolverId,
  key: ResolverSecretKey,
) {
  const expected: Record<ResolverId, ResolverSecretKey> = {
    xiaohongshu: "xhsCookie",
    douyin: "douyinCookie",
    wechat: "wechatArticleAuthKey",
  };

  if (expected[resolverId] !== key) {
    throw new Error(`Invalid key "${key}" for resolver "${resolverId}"`);
  }
}
