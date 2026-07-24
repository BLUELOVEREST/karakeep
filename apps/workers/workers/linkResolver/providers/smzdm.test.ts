import { afterEach, describe, expect, it, vi } from "vitest";

import { SmzdmProvider } from "./smzdm";

describe("SmzdmProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the SMZDM resolver service and maps article content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          source: "smzdm",
          backend: "mobile_html",
          url: "https://post.smzdm.com/p/ak8mxml9/",
          finalUrl: "https://post.smzdm.com/p/ak8mxml9/",
          articleId: "ak8mxml9",
          title: "什么值得买标题",
          author: {
            id: null,
            name: "作者昵称",
            avatar: "https://example.test/avatar.jpg",
          },
          summary: "文章摘要",
          publishedAt: "2026-07-21T17:17:29+08:00",
          contentMarkdown:
            "# 什么值得买标题\n\n第一段\n\n![图1](https://example.test/one.jpg)",
          contentHtml: "<p>第一段</p>",
          contentText: "第一段",
          coverImageUrl: "https://example.test/cover.jpg",
          images: [
            {
              url: "https://example.test/one.jpg",
              originalUrl: "//example.test/one.jpg",
              alt: "图1",
              index: 0,
            },
          ],
          tags: [],
          categories: ["电脑数码"],
          stats: {},
          raw: {},
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new SmzdmProvider({
      endpoint: "http://127.0.0.1:18063/api/smzdm/article",
    });

    const result = await provider.resolve({
      url: "https://post.smzdm.com/p/ak8mxml9/",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18063/api/smzdm/article",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: "https://post.smzdm.com/p/ak8mxml9/",
        }),
      }),
    );
    expect(result).toEqual({
      status: "success",
      content: {
        title: "什么值得买标题",
        description: "文章摘要",
        author: "作者昵称",
        publisher: "什么值得买",
        imageUrl: "https://example.test/cover.jpg",
        htmlContent: "<p>第一段</p>",
        archivableAssets: [
          {
            kind: "image",
            url: "https://example.test/cover.jpg",
            originalUrl: "https://example.test/cover.jpg",
            role: "cover",
          },
          {
            kind: "image",
            url: "https://example.test/one.jpg",
            originalUrl: "https://example.test/one.jpg",
            role: "content",
          },
        ],
        finalUrl: "https://post.smzdm.com/p/ak8mxml9/",
        datePublished: new Date("2026-07-21T17:17:29+08:00"),
      },
    });
  });

  it("uses the first article image when cover image is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            source: "smzdm",
            backend: "mobile_html",
            url: "https://post.smzdm.com/p/ak8mxml9/",
            finalUrl: "https://post.smzdm.com/p/ak8mxml9/",
            articleId: "ak8mxml9",
            title: "标题",
            author: { name: "" },
            summary: "",
            publishedAt: null,
            contentMarkdown: "",
            contentHtml: "<p>HTML 正文</p>",
            contentText: "HTML 正文",
            coverImageUrl: null,
            images: [{ url: "https://example.test/one.jpg", index: 0 }],
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new SmzdmProvider({
      endpoint: "http://127.0.0.1:18063/api/smzdm/article",
    });

    const result = await provider.resolve({
      url: "https://post.smzdm.com/p/ak8mxml9/",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "success",
      content: {
        title: "标题",
        description: "HTML 正文",
        author: null,
        publisher: "什么值得买",
        imageUrl: "https://example.test/one.jpg",
        htmlContent: "<p>HTML 正文</p>",
        archivableAssets: [
          {
            kind: "image",
            url: "https://example.test/one.jpg",
            originalUrl: "https://example.test/one.jpg",
            role: "cover",
          },
        ],
        finalUrl: "https://post.smzdm.com/p/ak8mxml9/",
        datePublished: null,
      },
    });
  });

  it("uses resolver-downloaded local image files and prefers HTML content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            source: "smzdm",
            backend: "mobile_html",
            url: "https://post.smzdm.com/p/ak8mxml9/",
            finalUrl: "https://post.smzdm.com/p/ak8mxml9/",
            articleId: "ak8mxml9",
            title: "标题",
            author: { name: "作者" },
            summary: "摘要",
            publishedAt: null,
            contentMarkdown: "# 标题\n\n![图1](https://am.zdmimg.com/img1.jpg)",
            contentHtml:
              '<article><p>正文 <a href="https://item.jd.com/1.html">购买链接</a></p><img src="https://am.zdmimg.com/img1.jpg" alt="图1"></article>',
            contentText: "正文",
            coverImageUrl: "https://a.zdmimg.com/cover.jpg",
            coverImage: {
              url: "https://a.zdmimg.com/cover.jpg",
              path: "/downloads/smzdm/ak8mxml9/cover.jpg",
              fileName: "cover.jpg",
              mimeType: "image/jpeg",
              role: "cover",
            },
            images: [
              {
                url: "https://am.zdmimg.com/img1.jpg",
                originalUrl: "//am.zdmimg.com/img1.jpg",
                alt: "图1",
                index: 0,
                localPath: "/downloads/smzdm/ak8mxml9/img1.jpg",
                fileName: "img1.jpg",
                mimeType: "image/jpeg",
                role: "content",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new SmzdmProvider({
      endpoint: "http://127.0.0.1:18063/api/smzdm/article",
    });

    const result = await provider.resolve({
      url: "https://post.smzdm.com/p/ak8mxml9/",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "success",
      content: {
        title: "标题",
        description: "摘要",
        author: "作者",
        publisher: "什么值得买",
        imageUrl: "https://a.zdmimg.com/cover.jpg",
        htmlContent:
          '<article><p>正文 <a href="https://item.jd.com/1.html">购买链接</a></p><img src="https://am.zdmimg.com/img1.jpg" alt="图1"></article>',
        archivableAssets: [
          {
            kind: "image",
            path: "/downloads/smzdm/ak8mxml9/cover.jpg",
            originalUrl: "https://a.zdmimg.com/cover.jpg",
            fileName: "cover.jpg",
            mimeType: "image/jpeg",
            role: "cover",
          },
          {
            kind: "image",
            path: "/downloads/smzdm/ak8mxml9/img1.jpg",
            originalUrl: "https://am.zdmimg.com/img1.jpg",
            fileName: "img1.jpg",
            mimeType: "image/jpeg",
            role: "content",
          },
        ],
        finalUrl: "https://post.smzdm.com/p/ak8mxml9/",
        datePublished: null,
      },
    });
  });

  it("returns resolver failure with retryability from the SMZDM service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            source: "smzdm",
            backend: "mobile_html",
            url: "https://post.smzdm.com/p/ak8mxml9/",
            articleId: "ak8mxml9",
            reason: "ANTI_BOT_BLOCKED",
            message: "SMZDM returned a verification or probe page.",
            retryable: true,
            raw: {},
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new SmzdmProvider({
      endpoint: "http://127.0.0.1:18063/api/smzdm/article",
    });

    const result = await provider.resolve({
      url: "https://post.smzdm.com/p/ak8mxml9/",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "failure",
      retryable: true,
      reason:
        "SMZDM resolver failed: ANTI_BOT_BLOCKED: SMZDM returned a verification or probe page.",
    });
  });
});
