import type {
  LinkResolverInput,
  LinkResolverProvider,
  LinkResolverResult,
} from "./types";
import { CoolapkProvider } from "./providers/coolapk";
import { SmzdmProvider } from "./providers/smzdm";
import { SpiderXhsProvider } from "./providers/spiderXhs";
import { WechatArticleProvider } from "./providers/wechatArticle";
import { XiaohongshuMcpProvider } from "./providers/xiaohongshuMcp";

export type XiaohongshuBackend = "auto" | "spider_xhs" | "mcp";

export interface LinkResolverRegistryOptions {
  xiaohongshuBackend?: XiaohongshuBackend;
  xiaohongshuSpiderEndpoint?: string;
  xiaohongshuMcpEndpoint?: string;
  coolapkResolverEndpoint?: string;
  smzdmResolverEndpoint?: string;
  wechatArticleResolverEndpoint?: string;
  wechatArticleAuthKey?: string;
}

class UnconfiguredXiaohongshuProvider implements LinkResolverProvider {
  id = "xiaohongshu-unconfigured";
  fallbackPolicy = "fail_fast" as const;

  canResolve(url: URL): boolean {
    return isXiaohongshuHost(url.hostname);
  }

  async resolve(_input: LinkResolverInput): Promise<LinkResolverResult> {
    return {
      status: "failure",
      retryable: false,
      reason:
        "Xiaohongshu resolver is not configured. Set XIAOHONGSHU_SPIDER_ENDPOINT or XIAOHONGSHU_MCP_ENDPOINT.",
    };
  }
}

function isXiaohongshuHost(hostname: string): boolean {
  return (
    hostname === "xiaohongshu.com" ||
    hostname.endsWith(".xiaohongshu.com") ||
    hostname === "xhslink.com" ||
    hostname.endsWith(".xhslink.com")
  );
}

class UnconfiguredCoolapkProvider implements LinkResolverProvider {
  id = "coolapk-unconfigured";
  fallbackPolicy = "fail_fast" as const;

  canResolve(url: URL): boolean {
    return isCoolapkHost(url.hostname);
  }

  async resolve(_input: LinkResolverInput): Promise<LinkResolverResult> {
    return {
      status: "failure",
      retryable: false,
      reason:
        "Coolapk resolver is not configured. Set COOLAPK_RESOLVER_ENDPOINT.",
    };
  }
}

function isCoolapkHost(hostname: string): boolean {
  return (
    hostname === "coolapk.com" ||
    hostname.endsWith(".coolapk.com") ||
    hostname === "coolmarket.com.cn" ||
    hostname.endsWith(".coolmarket.com.cn")
  );
}

class UnconfiguredSmzdmProvider implements LinkResolverProvider {
  id = "smzdm-unconfigured";
  fallbackPolicy = "fail_fast" as const;

  canResolve(url: URL): boolean {
    return isSmzdmArticleUrl(url);
  }

  async resolve(_input: LinkResolverInput): Promise<LinkResolverResult> {
    return {
      status: "failure",
      retryable: false,
      reason: "SMZDM resolver is not configured. Set SMZDM_RESOLVER_ENDPOINT.",
    };
  }
}

function isSmzdmArticleUrl(url: URL): boolean {
  return (
    (url.hostname === "post.smzdm.com" ||
      url.hostname === "post.m.smzdm.com") &&
    /^\/p\/[A-Za-z0-9]+\/?$/.test(url.pathname)
  );
}

class UnconfiguredWechatArticleProvider implements LinkResolverProvider {
  id = "wechat-article-unconfigured";
  fallbackPolicy = "fail_fast" as const;

  canResolve(url: URL): boolean {
    return isWechatArticleUrl(url);
  }

  async resolve(_input: LinkResolverInput): Promise<LinkResolverResult> {
    return {
      status: "failure",
      retryable: false,
      reason:
        "WeChat article resolver is not configured. Set WECHAT_ARTICLE_RESOLVER_ENDPOINT.",
    };
  }
}

function isWechatArticleUrl(url: URL): boolean {
  return (
    (url.hostname === "mp.weixin.qq.com" ||
      url.hostname.endsWith(".mp.weixin.qq.com")) &&
    url.pathname.startsWith("/s/")
  );
}

export interface LinkResolverRegistry {
  selectProvider(rawUrl: string): LinkResolverProvider | null;
}

export function buildLinkResolverRegistry(
  options: LinkResolverRegistryOptions,
): LinkResolverRegistry {
  const xiaohongshuBackend = options.xiaohongshuBackend ?? "auto";
  let xiaohongshuProvider: LinkResolverProvider;
  if (
    (xiaohongshuBackend === "auto" || xiaohongshuBackend === "spider_xhs") &&
    options.xiaohongshuSpiderEndpoint
  ) {
    xiaohongshuProvider = new SpiderXhsProvider({
      endpoint: options.xiaohongshuSpiderEndpoint,
    });
  } else if (
    (xiaohongshuBackend === "auto" || xiaohongshuBackend === "mcp") &&
    options.xiaohongshuMcpEndpoint
  ) {
    xiaohongshuProvider = new XiaohongshuMcpProvider({
      endpoint: options.xiaohongshuMcpEndpoint,
    });
  } else {
    xiaohongshuProvider = new UnconfiguredXiaohongshuProvider();
  }

  const coolapkProvider = options.coolapkResolverEndpoint
    ? new CoolapkProvider({ endpoint: options.coolapkResolverEndpoint })
    : new UnconfiguredCoolapkProvider();

  const smzdmProvider = options.smzdmResolverEndpoint
    ? new SmzdmProvider({ endpoint: options.smzdmResolverEndpoint })
    : new UnconfiguredSmzdmProvider();

  const wechatArticleProvider = options.wechatArticleResolverEndpoint
    ? new WechatArticleProvider({
        endpoint: options.wechatArticleResolverEndpoint,
        authKey: options.wechatArticleAuthKey,
      })
    : new UnconfiguredWechatArticleProvider();

  const providers: LinkResolverProvider[] = [
    xiaohongshuProvider,
    coolapkProvider,
    smzdmProvider,
    wechatArticleProvider,
  ];

  return {
    selectProvider(rawUrl: string): LinkResolverProvider | null {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return null;
      }
      return providers.find((provider) => provider.canResolve(url)) ?? null;
    },
  };
}
