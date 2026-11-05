import serverConfig from "@karakeep/shared/config";
import type { ZResolverHealth } from "@karakeep/shared/types/resolverHealth";

type ResolverConfig = Partial<
  Pick<
    typeof serverConfig.crawler,
    | "xiaohongshuBackend"
    | "xiaohongshuSpiderEndpoint"
    | "xiaohongshuMcpEndpoint"
    | "coolapkResolverEndpoint"
    | "smzdmResolverEndpoint"
    | "wechatArticleResolverEndpoint"
    | "douyinResolverEndpoint"
  >
>;
type HealthFetch = (url: URL, options: RequestInit) => Promise<Response>;
interface Target {
  id: ZResolverHealth["id"];
  endpoint?: string;
  path: string;
  unsupported?: boolean;
}

function targetsFor(config: ResolverConfig): Target[] {
  const useSpider =
    config.xiaohongshuBackend !== "mcp" && !!config.xiaohongshuSpiderEndpoint;
  const useMcp =
    config.xiaohongshuBackend !== "spider_xhs" &&
    !useSpider &&
    !!config.xiaohongshuMcpEndpoint;
  return [
    {
      id: "xiaohongshu",
      endpoint: useSpider
        ? config.xiaohongshuSpiderEndpoint
        : useMcp
          ? config.xiaohongshuMcpEndpoint
          : undefined,
      path: "/health",
      unsupported: useMcp,
    },
    {
      id: "douyin",
      endpoint: config.douyinResolverEndpoint,
      path: "/api/v1/health",
    },
    {
      id: "wechat",
      endpoint: config.wechatArticleResolverEndpoint,
      path: "/api/karakeep/v1/health",
    },
    {
      id: "coolapk",
      endpoint: config.coolapkResolverEndpoint,
      path: "/health",
    },
    { id: "smzdm", endpoint: config.smzdmResolverEndpoint, path: "/health" },
  ];
}

export class ResolverHealthChecker {
  private cache?: { key: string; expiresAt: number; rows: ZResolverHealth[] };
  private pending?: { key: string; promise: Promise<ZResolverHealth[]> };

  constructor(
    private readonly config: ResolverConfig = serverConfig.crawler,
    private readonly options: {
      fetch?: HealthFetch;
      timeoutMs?: number;
      cacheMs?: number;
    } = {},
  ) {}

  check(): Promise<ZResolverHealth[]> {
    const targets = targetsFor(this.config);
    const key = JSON.stringify(targets);
    if (this.cache?.key === key && this.cache.expiresAt > Date.now())
      return Promise.resolve(this.cache.rows);
    if (this.pending?.key === key) return this.pending.promise;
    const promise = Promise.all(targets.map((target) => this.probe(target)))
      .then((rows) => {
        this.cache = {
          key,
          rows,
          expiresAt: Date.now() + (this.options.cacheMs ?? 10000),
        };
        return rows;
      })
      .finally(() => {
        if (this.pending?.promise === promise) this.pending = undefined;
      });
    this.pending = { key, promise };
    return promise;
  }

  private async probe(target: Target): Promise<ZResolverHealth> {
    const row: ZResolverHealth = {
      id: target.id,
      status: "not_configured",
      checkedAt: new Date(),
      latencyMs: null,
      errorCode: null,
      httpStatus: null,
    };
    if (!target.endpoint) return row;
    if (target.unsupported)
      return {
        ...row,
        status: "not_checked",
        errorCode: "HEALTH_CHECK_UNSUPPORTED",
      };
    let url: URL;
    try {
      url = new URL(target.path, target.endpoint);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Invalid protocol");
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
    } catch {
      return { ...row, status: "error", errorCode: "INVALID_CONFIGURATION" };
    }
    const started = performance.now();
    const signal = AbortSignal.timeout(this.options.timeoutMs ?? 3000);
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        method: "GET",
        redirect: "error",
        signal,
      });
      row.httpStatus = response.status;
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const unsupported = response.status === 404 || response.status === 405;
        row.status = unsupported ? "not_checked" : "error";
        row.errorCode = unsupported ? "HEALTH_CHECK_UNSUPPORTED" : "HTTP_ERROR";
      } else {
        const body: unknown = await response.json();
        const healthy =
          !!body &&
          typeof body === "object" &&
          "status" in body &&
          body.status === "ok";
        row.status = healthy ? "connected" : "error";
        row.errorCode = healthy ? null : "INVALID_RESPONSE";
      }
    } catch (error) {
      row.status = "error";
      row.errorCode = signal.aborted
        ? "TIMEOUT"
        : error instanceof SyntaxError
          ? "INVALID_RESPONSE"
          : "CONNECTION_FAILED";
    } finally {
      row.latencyMs = Math.max(0, Math.round(performance.now() - started));
    }
    return row;
  }
}

export const resolverHealthChecker = new ResolverHealthChecker();
