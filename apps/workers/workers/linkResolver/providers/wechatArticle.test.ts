import { afterEach, describe, expect, it, vi } from "vitest";

import { WechatArticleProvider } from "./wechatArticle";

describe("WechatArticleProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the WeChat article resolver and maps content plus images", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          title: "微信公众号标题",
          author: "作者",
          accountName: "公众号",
          summary: "摘要",
          publishedAt: "2026-07-21T00:00:00.000Z",
          contentMarkdown:
            "# 微信公众号标题\n\n正文\n\n![图1](https://mmbiz.qpic.cn/one.jpg)",
          contentHtml: "<article>正文</article>",
          contentText: "正文",
          coverImageUrl: "https://mmbiz.qpic.cn/cover.jpg",
          finalUrl: "https://mp.weixin.qq.com/s/demo",
          images: [
            {
              url: "https://mmbiz.qpic.cn/one.jpg",
              originalUrl: "https://mmbiz.qpic.cn/one.jpg",
              index: 0,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new WechatArticleProvider({
      endpoint: "http://127.0.0.1:3000/api/karakeep/v1/wechat/article",
      authKey: "secret",
    });

    const result = await provider.resolve({
      url: "https://mp.weixin.qq.com/s/demo",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/karakeep/v1/wechat/article",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-auth-key": "secret" }),
        body: JSON.stringify({ url: "https://mp.weixin.qq.com/s/demo" }),
      }),
    );
    expect(result).toEqual({
      status: "success",
      content: {
        title: "微信公众号标题",
        description: "摘要",
        author: "作者",
        publisher: "公众号",
        imageUrl: "https://mmbiz.qpic.cn/cover.jpg",
        htmlContent:
          "# 微信公众号标题\n\n正文\n\n![图1](https://mmbiz.qpic.cn/one.jpg)",
        archivableAssets: [
          {
            kind: "image",
            url: "https://mmbiz.qpic.cn/cover.jpg",
            originalUrl: "https://mmbiz.qpic.cn/cover.jpg",
            role: "cover",
          },
          {
            kind: "image",
            url: "https://mmbiz.qpic.cn/one.jpg",
            originalUrl: "https://mmbiz.qpic.cn/one.jpg",
            role: "content",
          },
        ],
        finalUrl: "https://mp.weixin.qq.com/s/demo",
        datePublished: new Date("2026-07-21T00:00:00.000Z"),
      },
    });
  });
});
