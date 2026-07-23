import { describe, expect, it } from "vitest";

import { buildLinkResolverRegistry } from "./registry";

describe("buildLinkResolverRegistry", () => {
  it("selects the Spider_XHS provider for xiaohongshu domains when configured", () => {
    const registry = buildLinkResolverRegistry({
      xiaohongshuSpiderEndpoint: "http://127.0.0.1:18061/api/xhs/note",
    });

    const provider = registry.selectProvider(
      "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD",
    );

    expect(provider?.id).toBe("spider-xhs");
  });

  it("can still select the xiaohongshu-mcp provider explicitly", () => {
    const registry = buildLinkResolverRegistry({
      xiaohongshuBackend: "mcp",
      xiaohongshuSpiderEndpoint: "http://127.0.0.1:18061/api/xhs/note",
      xiaohongshuMcpEndpoint: "http://127.0.0.1:18060/mcp",
    });

    const provider = registry.selectProvider(
      "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD",
    );

    expect(provider?.id).toBe("xiaohongshu-mcp");
  });

  it("returns fail-fast for xiaohongshu domains when the external resolver is not configured", () => {
    const registry = buildLinkResolverRegistry({
      xiaohongshuBackend: "spider_xhs",
    });

    const provider = registry.selectProvider(
      "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD",
    );

    expect(provider?.id).toBe("xiaohongshu-unconfigured");
    expect(provider?.fallbackPolicy).toBe("fail_fast");
  });

  it("selects the Coolapk provider for coolapk domains when configured", () => {
    const registry = buildLinkResolverRegistry({
      coolapkResolverEndpoint: "http://127.0.0.1:18062/api/coolapk/feed",
    });

    const provider = registry.selectProvider(
      "https://www.coolapk.com/feed/71896052",
    );

    expect(provider?.id).toBe("coolapk");
  });

  it("returns fail-fast for coolapk domains when the external resolver is not configured", () => {
    const registry = buildLinkResolverRegistry({});

    const provider = registry.selectProvider(
      "https://www.coolapk.com/feed/71896052",
    );

    expect(provider?.id).toBe("coolapk-unconfigured");
    expect(provider?.fallbackPolicy).toBe("fail_fast");
  });

  it("selects the SMZDM provider for article domains when configured", () => {
    const registry = buildLinkResolverRegistry({
      smzdmResolverEndpoint: "http://127.0.0.1:18063/api/smzdm/article",
    });

    const provider = registry.selectProvider(
      "https://post.smzdm.com/p/ak8mxml9/",
    );

    expect(provider?.id).toBe("smzdm");
  });

  it("returns fail-fast for SMZDM article domains when the external resolver is not configured", () => {
    const registry = buildLinkResolverRegistry({});

    const provider = registry.selectProvider(
      "https://post.m.smzdm.com/p/ak8mxml9/",
    );

    expect(provider?.id).toBe("smzdm-unconfigured");
    expect(provider?.fallbackPolicy).toBe("fail_fast");
  });

  it("selects the WeChat article provider when configured", () => {
    const registry = buildLinkResolverRegistry({
      wechatArticleResolverEndpoint:
        "http://127.0.0.1:3000/api/karakeep/v1/wechat/article",
    });

    const provider = registry.selectProvider("https://mp.weixin.qq.com/s/demo");

    expect(provider?.id).toBe("wechat-article");
  });

  it("returns fail-fast for WeChat article domains when the external resolver is not configured", () => {
    const registry = buildLinkResolverRegistry({});

    const provider = registry.selectProvider("https://mp.weixin.qq.com/s/demo");

    expect(provider?.id).toBe("wechat-article-unconfigured");
    expect(provider?.fallbackPolicy).toBe("fail_fast");
  });

  it("returns null for generic webpages", () => {
    const registry = buildLinkResolverRegistry({
      xiaohongshuSpiderEndpoint: "http://127.0.0.1:18061/api/xhs/note",
    });

    expect(registry.selectProvider("https://example.com/article")).toBeNull();
  });
});
