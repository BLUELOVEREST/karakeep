import { inArray } from "drizzle-orm";

import { config } from "@karakeep/db/schema";
import {
  resolverSourceKey,
  withResolverSettingsLock,
  writeResolverSecret,
} from "@karakeep/shared-server";
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
    const sources = await this.ctx.db.query.config.findMany({
      where: inArray(
        config.key,
        SETTINGS.map((setting) => resolverSourceKey(setting.resolverId)),
      ),
    });

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
              ? sources.find(
                  (row) => row.key === resolverSourceKey(setting.resolverId),
                )?.value === "cookiecloud"
                ? ("cookiecloud" as const)
                : ("runtime" as const)
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
    if (!value) throw new Error("Cookie or service key must not be empty");
    await withResolverSettingsLock(this.ctx.db, () =>
      writeResolverSecret(this.ctx.db, {
        ...input,
        value,
        updatedBy: this.ctx.user.id,
        source: "manual",
      }),
    );
  }

  async clear(input: { resolverId: ResolverId; key: ResolverSecretKey }) {
    await withResolverSettingsLock(this.ctx.db, () =>
      writeResolverSecret(this.ctx.db, {
        ...input,
        value: null,
        updatedBy: this.ctx.user.id,
        source: "manual",
      }),
    );
  }
}
