import { afterEach, describe, expect, it, vi } from "vitest";

import { ResolverHealthChecker } from "./resolverHealth";

const endpoints = {
  xiaohongshuBackend: "spider_xhs" as const,
  xiaohongshuSpiderEndpoint: "http://xhs:18061/api/xhs/note",
  coolapkResolverEndpoint: "http://coolapk:18062/api/coolapk/feed",
  smzdmResolverEndpoint: "http://smzdm:18063/api/smzdm/article",
  wechatArticleResolverEndpoint:
    "http://wechat:3000/api/karakeep/v1/wechat/article",
  douyinResolverEndpoint: "http://douyin:18064/api/karakeep/v1/douyin",
};
const healthy = () => Response.json({ status: "ok" });
type HealthFetch = (url: URL, options: RequestInit) => Promise<Response>;
afterEach(() => vi.useRealTimers());

describe("resolver connection health", () => {
  it("lists all five unconfigured services without network requests", async () => {
    const fetcher = vi.fn();
    const rows = await new ResolverHealthChecker(
      {},
      { fetch: fetcher },
    ).check();
    expect(rows.map((row) => row.id).sort()).toEqual([
      "coolapk",
      "douyin",
      "smzdm",
      "wechat",
      "xiaohongshu",
    ]);
    expect(
      rows.every(
        (row) => row.status === "not_configured" && row.latencyMs === null,
      ),
    ).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("probes only the platform health routes using credential-free GET requests", async () => {
    const fetcher = vi.fn<HealthFetch>(async () => healthy());
    const rows = await new ResolverHealthChecker(endpoints, {
      fetch: fetcher,
    }).check();
    expect(fetcher.mock.calls.map((call) => String(call[0])).sort()).toEqual([
      "http://coolapk:18062/health",
      "http://douyin:18064/api/v1/health",
      "http://smzdm:18063/health",
      "http://wechat:3000/api/karakeep/v1/health",
      "http://xhs:18061/health",
    ]);
    for (const [, options] of fetcher.mock.calls)
      expect(options).toMatchObject({ method: "GET", redirect: "error" });
    expect(
      rows.every(
        (row) =>
          row.status === "connected" &&
          row.checkedAt instanceof Date &&
          row.latencyMs! >= 0,
      ),
    ).toBe(true);
    expect(rows.every((row) => typeof row.latencyMs === "number")).toBe(true);
  });

  it("strips credentials and query tokens and never returns endpoint URLs or remote response bodies", async () => {
    const fetcher = vi.fn<HealthFetch>(
      async () =>
        new Response("secret-cookie upstream response", { status: 503 }),
    );
    const rows = await new ResolverHealthChecker(
      {
        coolapkResolverEndpoint:
          "http://user:secret-password@coolapk:18062/feed?token=secret-token#secret-fragment",
      },
      { fetch: fetcher },
    ).check();
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "http://coolapk:18062/health",
    );
    expect(rows.find((row) => row.id === "coolapk")).toMatchObject({
      status: "error",
      errorCode: "HTTP_ERROR",
      httpStatus: 503,
    });
    expect(JSON.stringify(rows)).not.toMatch(
      /secret|upstream response|coolapk:18062/,
    );
  });

  it.each([404, 405])(
    "does not claim an old resolver is offline for HTTP %s",
    async (status) => {
      const rows = await new ResolverHealthChecker(
        {
          wechatArticleResolverEndpoint:
            endpoints.wechatArticleResolverEndpoint,
        },
        { fetch: vi.fn(async () => new Response(null, { status })) },
      ).check();
      expect(rows.find((row) => row.id === "wechat")).toMatchObject({
        status: "not_checked",
        errorCode: "HEALTH_CHECK_UNSUPPORTED",
      });
    },
  );

  it.each([
    "not-json",
    JSON.stringify({ status: "error", message: "secret" }),
    JSON.stringify({ unrelated: true }),
  ])("rejects invalid health responses without leaking them", async (body) => {
    const rows = await new ResolverHealthChecker(
      { coolapkResolverEndpoint: endpoints.coolapkResolverEndpoint },
      { fetch: vi.fn(async () => new Response(body)) },
    ).check();
    expect(rows.find((row) => row.id === "coolapk")).toMatchObject({
      status: "error",
      errorCode: "INVALID_RESPONSE",
    });
    expect(JSON.stringify(rows)).not.toContain("secret");
  });

  it("isolates a network failure from the other four resolvers", async () => {
    const fetcher = vi.fn(async (url: URL) => {
      if (url.hostname === "xhs") throw new Error("secret-token failed fetch");
      return healthy();
    });
    const rows = await new ResolverHealthChecker(endpoints, {
      fetch: fetcher,
    }).check();
    expect(rows.filter((row) => row.status === "connected")).toHaveLength(4);
    expect(rows.find((row) => row.id === "xiaohongshu")?.errorCode).toBe(
      "CONNECTION_FAILED",
    );
    expect(JSON.stringify(rows)).not.toContain("secret-token");
  });

  it("bounds a hung request with an abort signal", async () => {
    const fetcher = vi.fn(
      (_url: URL, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener(
            "abort",
            () => reject(options.signal!.reason),
            { once: true },
          );
        }),
    );
    const rows = await new ResolverHealthChecker(
      { douyinResolverEndpoint: endpoints.douyinResolverEndpoint },
      { fetch: fetcher, timeoutMs: 20 },
    ).check();
    expect(rows.find((row) => row.id === "douyin")).toMatchObject({
      status: "error",
      errorCode: "TIMEOUT",
    });
  });

  it("also times out when headers arrive but the response body stalls", async () => {
    const fetcher = vi.fn<HealthFetch>(
      async (_url, options) =>
        new Response(
          new ReadableStream({
            start(controller) {
              options.signal!.addEventListener(
                "abort",
                () => controller.error(options.signal!.reason),
                { once: true },
              );
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const rows = await new ResolverHealthChecker(
      { coolapkResolverEndpoint: endpoints.coolapkResolverEndpoint },
      { fetch: fetcher, timeoutMs: 20 },
    ).check();
    expect(rows.find((row) => row.id === "coolapk")).toMatchObject({
      status: "error",
      errorCode: "TIMEOUT",
      httpStatus: 200,
    });
  });

  it("runs probes in parallel and coalesces concurrent requests", async () => {
    const releases: (() => void)[] = [];
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) =>
          releases.push(() => resolve(healthy())),
        ),
    );
    const checker = new ResolverHealthChecker(endpoints, { fetch: fetcher });
    const first = checker.check();
    const second = checker.check();
    expect(fetcher).toHaveBeenCalledTimes(5);
    releases.forEach((release) => release());
    expect(await first).toEqual(await second);
    await checker.check();
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("refreshes the cache after ten seconds and after endpoint changes", async () => {
    vi.useFakeTimers();
    const config = {
      coolapkResolverEndpoint: endpoints.coolapkResolverEndpoint,
    };
    const fetcher = vi.fn(async () => healthy());
    const checker = new ResolverHealthChecker(config, { fetch: fetcher });
    await checker.check();
    await checker.check();
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10001);
    await checker.check();
    expect(fetcher).toHaveBeenCalledTimes(2);
    config.coolapkResolverEndpoint = "http://new-coolapk:18062/feed";
    await checker.check();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not probe an inactive XHS spider when MCP is selected", async () => {
    const fetcher = vi.fn();
    const rows = await new ResolverHealthChecker(
      {
        ...endpoints,
        xiaohongshuBackend: "mcp",
        xiaohongshuMcpEndpoint: "http://mcp:9000/mcp",
        coolapkResolverEndpoint: undefined,
        smzdmResolverEndpoint: undefined,
        wechatArticleResolverEndpoint: undefined,
        douyinResolverEndpoint: undefined,
      },
      { fetch: fetcher },
    ).check();
    expect(rows.find((row) => row.id === "xiaohongshu")).toMatchObject({
      status: "not_checked",
      errorCode: "HEALTH_CHECK_UNSUPPORTED",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects non-HTTP endpoint configuration without fetching", async () => {
    const fetcher = vi.fn();
    const rows = await new ResolverHealthChecker(
      { coolapkResolverEndpoint: "file:///private/secret" },
      { fetch: fetcher },
    ).check();
    expect(rows.find((row) => row.id === "coolapk")).toMatchObject({
      status: "error",
      errorCode: "INVALID_CONFIGURATION",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
