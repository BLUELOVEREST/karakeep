import { inArray } from "drizzle-orm";

import { db } from "@karakeep/db";
import { resolverRuntimeConfigs } from "@karakeep/db/schema";
import serverConfig from "@karakeep/shared/config";
import logger from "@karakeep/shared/logger";

export interface RuntimeResolverSecrets {
  xhsCookie?: string;
  douyinCookie?: string;
  wechatArticleAuthKey?: string;
}

export async function loadRuntimeResolverSecrets(): Promise<RuntimeResolverSecrets> {
  const rows = await db
    .select()
    .from(resolverRuntimeConfigs)
    .where(
      inArray(resolverRuntimeConfigs.resolverId, [
        "xiaohongshu",
        "douyin",
        "wechat",
      ]),
    );

  const findValue = (key: string) =>
    rows.find((row) => row.key === key)?.value.trim() || undefined;

  return {
    xhsCookie: findValue("xhsCookie"),
    douyinCookie: findValue("douyinCookie"),
    wechatArticleAuthKey:
      findValue("wechatArticleAuthKey") ??
      serverConfig.crawler.wechatArticleAuthKey,
  };
}

export async function syncRuntimeSecretsForUrl(
  rawUrl: string,
  secrets: RuntimeResolverSecrets,
) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }

  if (isXiaohongshuHost(url.hostname) && secrets.xhsCookie) {
    await syncResolverConfig({
      endpoint: serverConfig.crawler.xiaohongshuSpiderEndpoint,
      payload: { xhsCookie: secrets.xhsCookie },
      resolverName: "xiaohongshu",
    });
  }

  if (isDouyinHost(url.hostname) && secrets.douyinCookie) {
    await syncResolverConfig({
      endpoint: serverConfig.crawler.douyinResolverEndpoint,
      payload: { douyinCookie: secrets.douyinCookie },
      resolverName: "douyin",
    });
  }
}

async function syncResolverConfig({
  endpoint,
  payload,
  resolverName,
}: {
  endpoint?: string;
  payload: Record<string, string>;
  resolverName: string;
}) {
  if (!endpoint) {
    return;
  }

  const configUrl = new URL("/api/karakeep/v1/config", endpoint);
  const response = await fetch(configUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    logger.warn(
      `[ResolverConfig] Failed to sync ${resolverName} runtime config: HTTP ${response.status}`,
    );
  }
}

function isXiaohongshuHost(hostname: string): boolean {
  return (
    hostname === "xiaohongshu.com" ||
    hostname.endsWith(".xiaohongshu.com") ||
    hostname === "xhslink.com" ||
    hostname.endsWith(".xhslink.com") ||
    hostname === "xhslink.cn" ||
    hostname.endsWith(".xhslink.cn")
  );
}

function isDouyinHost(hostname: string): boolean {
  return (
    hostname === "douyin.com" ||
    hostname.endsWith(".douyin.com") ||
    hostname === "iesdouyin.com" ||
    hostname.endsWith(".iesdouyin.com")
  );
}
