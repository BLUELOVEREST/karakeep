import type {
  LinkResolverInput,
  LinkResolverProvider,
  LinkResolverResult,
} from "./types";
import { SpiderXhsProvider } from "./providers/spiderXhs";
import { XiaohongshuMcpProvider } from "./providers/xiaohongshuMcp";

export type XiaohongshuBackend = "auto" | "spider_xhs" | "mcp";

export interface LinkResolverRegistryOptions {
  xiaohongshuBackend?: XiaohongshuBackend;
  xiaohongshuSpiderEndpoint?: string;
  xiaohongshuMcpEndpoint?: string;
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

  const providers: LinkResolverProvider[] = [xiaohongshuProvider];

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
