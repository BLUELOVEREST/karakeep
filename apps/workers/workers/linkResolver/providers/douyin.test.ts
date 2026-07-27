import { afterEach, describe, expect, it, vi } from "vitest";

import { DouyinProvider } from "./douyin";

describe("DouyinProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads Douyin resolver assets and maps cover video metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            source: "douyin",
            backend: "douyin-downloader",
            jobId: "job-1",
            status: "pending",
            url: "https://www.douyin.com/video/123",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            source: "douyin",
            backend: "douyin-downloader",
            jobId: "job-1",
            status: "success",
            result: {
              items: [
                {
                  awemeId: "123",
                  title: "抖音标题",
                  author: "作者",
                  mediaType: "video",
                  publishedAt: "2026-03-04T05:48:35Z",
                  files: [
                    {
                      type: "cover",
                      path: "/downloads/item_cover.jpg",
                      name: "item_cover.jpg",
                      mimeType: "image/jpeg",
                    },
                    {
                      type: "video",
                      path: "/downloads/item.mp4",
                      name: "item.mp4",
                      mimeType: "video/mp4",
                    },
                    {
                      type: "metadata",
                      path: "/downloads/item_data.json",
                      name: "item_data.json",
                      mimeType: "application/json",
                    },
                  ],
                },
              ],
            },
            error: null,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DouyinProvider({
      endpoint: "http://127.0.0.1:18064/api/karakeep/v1/douyin",
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    const result = await provider.resolve({
      url: "https://www.douyin.com/video/123",
      userId: "user-1",
      jobId: "job-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "success",
      content: expect.objectContaining({
        title: "抖音标题",
        author: "作者",
        publisher: "抖音",
        finalUrl: "https://www.douyin.com/video/123",
        skipVideoDownload: true,
        archivableAssets: [
          {
            kind: "image",
            path: "/downloads/item_cover.jpg",
            originalUrl: "/downloads/item_cover.jpg",
            fileName: "item_cover.jpg",
            mimeType: "image/jpeg",
            role: "cover",
          },
          {
            kind: "video",
            path: "/downloads/item.mp4",
            originalUrl: "/downloads/item.mp4",
            fileName: "item.mp4",
            mimeType: "video/mp4",
            role: "content",
          },
          {
            kind: "file",
            path: "/downloads/item_data.json",
            fileName: "item_data.json",
            mimeType: "application/json",
            role: "metadata",
          },
        ],
      }),
    });
    if (result.status === "success") {
      expect(result.content.htmlContent).toContain(
        '<video src="/downloads/item.mp4"',
      );
      expect(result.content.htmlContent).toContain(
        'poster="/downloads/item_cover.jpg"',
      );
    }
  });

  it("returns resolver failure details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            reason: "UNSUPPORTED_URL_TYPE",
            message: "URL type is not supported",
            retryable: false,
          }),
          { status: 400 },
        ),
      ),
    );

    const provider = new DouyinProvider({
      endpoint: "http://127.0.0.1:18064/api/karakeep/v1/douyin",
    });

    await expect(
      provider.resolve({
        url: "https://www.douyin.com/user/abc",
        userId: "user-1",
        jobId: "job-1",
        bookmarkId: "bookmark-1",
        abortSignal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      status: "failure",
      retryable: false,
      reason:
        "Douyin resolver failed: UNSUPPORTED_URL_TYPE: URL type is not supported",
    });
  });
});
