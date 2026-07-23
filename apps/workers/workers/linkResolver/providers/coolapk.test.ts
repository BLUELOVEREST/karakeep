import { afterEach, describe, expect, it, vi } from "vitest";

import { CoolapkProvider } from "./coolapk";

describe("CoolapkProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the Coolapk resolver service and preserves ordered blocks as reader html", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          msg: "success",
          feed: {
            id: 71896052,
            type: "动态",
            title: "酷安标题",
            message: "兼容正文",
            author: {
              uid: 536381,
              username: "wherewhere",
              avatar: "https://example.test/avatar.jpg",
            },
            images: ["https://example.test/fallback.jpg"],
            blocks: [
              { type: "text", text: "第一段" },
              {
                type: "image",
                url: "https://example.test/a.jpg",
                description: "图一",
              },
              { type: "text", text: "第二段" },
            ],
            share_url: "https://www.coolapk.com/feed/71896052",
            created_at: 1726069882,
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new CoolapkProvider({
      endpoint: "http://127.0.0.1:18062/api/coolapk/feed",
    });

    const result = await provider.resolve({
      url: "https://www.coolapk.com/feed/71896052",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18062/api/coolapk/feed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: "https://www.coolapk.com/feed/71896052",
        }),
      }),
    );
    expect(result).toEqual({
      status: "success",
      content: {
        title: "酷安标题",
        description: "兼容正文",
        author: "wherewhere",
        imageUrl: "https://example.test/a.jpg",
        htmlContent:
          '<article><h1>酷安标题</h1><p>第一段</p><figure><img src="https://example.test/a.jpg" alt="图一"><figcaption>图一</figcaption></figure><p>第二段</p></article>',
        archivableAssets: [
          {
            kind: "image",
            url: "https://example.test/a.jpg",
            originalUrl: "https://example.test/a.jpg",
            role: "cover",
          },
          {
            kind: "image",
            url: "https://example.test/fallback.jpg",
            originalUrl: "https://example.test/fallback.jpg",
            role: "content",
          },
        ],
        finalUrl: "https://www.coolapk.com/feed/71896052",
        datePublished: new Date(1726069882 * 1000),
      },
    });
  });

  it("preserves escaped links from Coolapk text blocks as clickable anchors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            msg: "success",
            feed: {
              title: "带链接正文",
              message: "兼容正文",
              blocks: [
                {
                  type: "text",
                  text: 'TrickyStore下载地址：&lt;a class="feed-link-url" href="https://github.com/5ec1cff/TrickyStore" title="https://github.com/5ec1cff/TrickyStore" target="_blank" rel="nofollow"&gt;查看链接&lt;/a&gt;\nPlayIntegrityFix下载地址&lt;!--break--&gt;：&lt;a class="feed-link-url" href="https://github.com/KOWX712/PlayIntegrityFix" title="https://github.com/KOWX712/PlayIntegrityFix" target="_blank" rel="nofollow"&gt;查看链接&lt;/a&gt;',
                },
              ],
              share_url: "https://www.coolapk.com/feed/1",
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new CoolapkProvider({
      endpoint: "http://127.0.0.1:18062/api/coolapk/feed",
    });

    const result = await provider.resolve({
      url: "https://www.coolapk.com/feed/1",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: "success",
      content: {
        htmlContent:
          '<article><h1>带链接正文</h1><p>TrickyStore下载地址：<a class="feed-link-url" href="https://github.com/5ec1cff/TrickyStore" title="https://github.com/5ec1cff/TrickyStore" target="_blank" rel="nofollow">查看链接</a><br>PlayIntegrityFix下载地址：<a class="feed-link-url" href="https://github.com/KOWX712/PlayIntegrityFix" title="https://github.com/KOWX712/PlayIntegrityFix" target="_blank" rel="nofollow">查看链接</a></p></article>',
      },
    });
  });

  it("falls back to message plus images when ordered blocks are absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            msg: "success",
            feed: {
              title: "",
              message: "只有正文",
              author: { username: "alice" },
              images: ["https://example.test/one.jpg"],
              share_url: "https://www.coolapk.com/feed/1",
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new CoolapkProvider({
      endpoint: "http://127.0.0.1:18062/api/coolapk/feed",
    });

    const result = await provider.resolve({
      url: "https://www.coolapk.com/feed/1",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "success",
      content: {
        title: null,
        description: "只有正文",
        author: "alice",
        imageUrl: "https://example.test/one.jpg",
        htmlContent:
          '<article><p>只有正文</p><figure><img src="https://example.test/one.jpg" alt="image 1"></figure></article>',
        archivableAssets: [
          {
            kind: "image",
            url: "https://example.test/one.jpg",
            originalUrl: "https://example.test/one.jpg",
            role: "cover",
          },
        ],
        finalUrl: "https://www.coolapk.com/feed/1",
        datePublished: null,
      },
    });
  });

  it("normalizes relative share urls against the input URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            msg: "success",
            feed: {
              title: "相对链接",
              message: "正文",
              author: { username: "alice" },
              images: [],
              blocks: [],
              share_url: "/feed/71896052",
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new CoolapkProvider({
      endpoint: "http://127.0.0.1:18062/api/coolapk/feed",
    });

    const result = await provider.resolve({
      url: "https://www.coolapk.com/feed/71896052",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: "success",
      content: {
        finalUrl: "https://www.coolapk.com/feed/71896052",
      },
    });
  });

  it("uses resolver-downloaded local image files when available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            msg: "success",
            feed: {
              title: "本地图片",
              message: "正文",
              author: { username: "alice" },
              images: ["https://image.coolapk.com/a.jpg"],
              blocks: [
                { type: "text", text: "正文" },
                {
                  type: "image",
                  url: "https://image.coolapk.com/a.jpg",
                  path: "/downloads/coolapk/1/a.jpg",
                  file_name: "a.jpg",
                  mime_type: "image/jpeg",
                },
              ],
              assets: [
                {
                  type: "image",
                  url: "https://image.coolapk.com/a.jpg",
                  path: "/downloads/coolapk/1/a.jpg",
                  file_name: "a.jpg",
                  mime_type: "image/jpeg",
                  role: "cover",
                },
              ],
              share_url: "https://www.coolapk.com/feed/1",
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new CoolapkProvider({
      endpoint: "http://127.0.0.1:18062/api/coolapk/feed",
    });

    const result = await provider.resolve({
      url: "https://www.coolapk.com/feed/1",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: "success",
      content: {
        archivableAssets: [
          {
            kind: "image",
            path: "/downloads/coolapk/1/a.jpg",
            originalUrl: "https://image.coolapk.com/a.jpg",
            fileName: "a.jpg",
            mimeType: "image/jpeg",
            role: "cover",
          },
        ],
      },
    });
  });

  it("returns a non-retryable failure when the Coolapk resolver reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            msg: "Unable to extract Coolapk feed id from url",
            feed: null,
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new CoolapkProvider({
      endpoint: "http://127.0.0.1:18062/api/coolapk/feed",
    });

    const result = await provider.resolve({
      url: "https://www.coolapk.com/apk/com.coolapk.market",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "failure",
      retryable: false,
      reason:
        "Coolapk resolver failed: Unable to extract Coolapk feed id from url",
    });
  });
});
