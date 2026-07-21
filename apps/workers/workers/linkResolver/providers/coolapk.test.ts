import { afterEach, describe, expect, it, vi } from "vitest";

import { CoolapkProvider } from "./coolapk";

describe("CoolapkProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the Coolapk resolver service and preserves ordered blocks as markdown", async () => {
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
          "# 酷安标题\n\n第一段\n\n![图一](https://example.test/a.jpg)\n\n第二段",
        finalUrl: "https://www.coolapk.com/feed/71896052",
        datePublished: new Date(1726069882 * 1000),
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
        htmlContent: "只有正文\n\n![image 1](https://example.test/one.jpg)",
        finalUrl: "https://www.coolapk.com/feed/1",
        datePublished: null,
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
