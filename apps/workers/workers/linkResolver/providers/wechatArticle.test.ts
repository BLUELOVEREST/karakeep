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
        htmlContent: "<article>正文</article>",
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

  it("prefers resolver HTML and downloaded local image assets", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          title: "微信公众号标题",
          summary: "摘要",
          contentMarkdown:
            "# 微信公众号标题\n\n正文\n\n![图1](https://mmbiz.qpic.cn/one.jpg)",
          contentHtml:
            '<section><p>正文</p><img src="https://mmbiz.qpic.cn/one.jpg"></section>',
          contentText: "正文",
          coverImageUrl: "https://mmbiz.qpic.cn/cover.jpg",
          coverImage: {
            url: "https://mmbiz.qpic.cn/cover.jpg",
            originalUrl: "https://mmbiz.qpic.cn/cover.jpg",
            path: "/downloads/wechat/demo/cover.jpg",
            fileName: "cover.jpg",
            mimeType: "image/jpeg",
          },
          finalUrl: "https://mp.weixin.qq.com/s/demo",
          images: [
            {
              url: "https://mmbiz.qpic.cn/one.jpg",
              originalUrl: "https://mmbiz.qpic.cn/one.jpg",
              path: "/downloads/wechat/demo/one.jpg",
              fileName: "one.jpg",
              mimeType: "image/jpeg",
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
    });

    const result = await provider.resolve({
      url: "https://mp.weixin.qq.com/s/demo",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "success",
      content: expect.objectContaining({
        imageUrl: "https://mmbiz.qpic.cn/cover.jpg",
        htmlContent:
          '<article><section><p>正文</p><img src="https://mmbiz.qpic.cn/one.jpg"></section></article>',
        archivableAssets: [
          {
            kind: "image",
            path: "/downloads/wechat/demo/cover.jpg",
            originalUrl: "https://mmbiz.qpic.cn/cover.jpg",
            fileName: "cover.jpg",
            mimeType: "image/jpeg",
            role: "cover",
          },
          {
            kind: "image",
            path: "/downloads/wechat/demo/one.jpg",
            originalUrl: "https://mmbiz.qpic.cn/one.jpg",
            fileName: "one.jpg",
            mimeType: "image/jpeg",
            role: "content",
          },
        ],
      }),
    });
  });

  it("removes forced white backgrounds from resolver HTML for dark reader mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          title: "微信公众号标题",
          summary: "摘要",
          contentHtml:
            '<section style="margin: 8px; background-color: rgb(255, 255, 255); color: rgb(10, 10, 10);"><p style="background: #fff; letter-spacing: 0.1em;">正文</p><img style="display: block; background-color: white; max-width: 100%;" src="https://mmbiz.qpic.cn/one.jpg"></section>',
          coverImageUrl: "https://mmbiz.qpic.cn/cover.jpg",
          finalUrl: "https://mp.weixin.qq.com/s/demo",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new WechatArticleProvider({
      endpoint: "http://127.0.0.1:3000/api/karakeep/v1/wechat/article",
    });

    const result = await provider.resolve({
      url: "https://mp.weixin.qq.com/s/demo",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "success",
      content: expect.objectContaining({
        htmlContent:
          '<article><section style="margin: 8px; color: rgb(10, 10, 10);"><p style="letter-spacing: 0.1em;">正文</p><img style="display: block; max-width: 100%;" src="https://mmbiz.qpic.cn/one.jpg"></section></article>',
      }),
    });
  });
});
