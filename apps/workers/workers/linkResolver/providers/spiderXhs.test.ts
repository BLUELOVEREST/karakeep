import { afterEach, describe, expect, it, vi } from "vitest";

import { SpiderXhsProvider } from "./spiderXhs";

describe("SpiderXhsProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads image note assets through Spider_XHS before returning archivable assets", async () => {
    const fetchMock = vi.fn();
    const imageUrls = [
      "https://sns-img.example.com/coffee.jpg",
      "https://sns-img.example.com/book.jpg",
    ];
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          msg: "success",
          note: {
            type: "image",
            title: "周末咖啡",
            desc: "这家店适合安静看书",
            user: { nickname: "Eric" },
            images: [
              {
                url: imageUrls[0],
                index: 0,
                width: null,
                height: null,
              },
              {
                url: imageUrls[1],
                index: 1,
                width: null,
                height: null,
              },
            ],
            assets: [
              {
                kind: "image",
                url: imageUrls[0],
                index: 0,
                role: "content",
                mimeType: "image/jpeg",
              },
              {
                kind: "image",
                url: imageUrls[1],
                index: 1,
                role: "content",
                mimeType: "image/jpeg",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          msg: "success",
          note: { id: "note123", type: "image", title: "周末咖啡" },
          files: [
            {
              kind: "image",
              role: "content",
              index: 0,
              path: "/downloads/xhs/note123/image_0.jpg",
              name: "image_0.jpg",
              mimeType: "image/jpeg",
            },
            {
              kind: "image",
              role: "content",
              index: 1,
              path: "/downloads/xhs/note123/image_1.jpg",
              name: "image_1.jpg",
              mimeType: "image/jpeg",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new SpiderXhsProvider({
      endpoint: "http://127.0.0.1:18061/api/xhs/note",
      downloadEndpoint: "http://127.0.0.1:18061/api/xhs/download",
    });

    const result = await provider.resolve({
      url: "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18061/api/xhs/note",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18061/api/xhs/download",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD",
          mediaTypes: ["image"],
        }),
      }),
    );
    expect(result).toEqual({
      status: "success",
      content: {
        title: "周末咖啡",
        description: "这家店适合安静看书",
        author: "Eric",
        imageUrl: null,
        htmlContent: expect.stringContaining('class="xhs-gallery"'),
        archivableAssets: [
          {
            kind: "image",
            path: "/downloads/xhs/note123/image_0.jpg",
            fileName: "image_0.jpg",
            mimeType: "image/jpeg",
            originalUrl: imageUrls[0],
            role: "cover",
          },
          {
            kind: "image",
            path: "/downloads/xhs/note123/image_1.jpg",
            fileName: "image_1.jpg",
            mimeType: "image/jpeg",
            originalUrl: imageUrls[1],
            role: "content",
          },
        ],
        finalUrl:
          "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD",
        skipVideoDownload: true,
      },
    });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      const htmlContent = result.content.htmlContent ?? "";
      expect(htmlContent).toContain("scroll-snap-type: x mandatory");
      expect(htmlContent).toContain(`<img src="${imageUrls[0]}"`);
      expect(htmlContent).toContain(`<img src="${imageUrls[1]}"`);
      expect(htmlContent.indexOf('class="xhs-gallery"')).toBeLessThan(
        htmlContent.indexOf("这家店适合安静看书"),
      );
    }
  });

  it("downloads live photo videos and renders them in the Xiaohongshu gallery", async () => {
    const fetchMock = vi.fn();
    const imageUrl = "https://sns-img.example.com/live.webp";
    const liveVideoUrl = "https://sns-video.example.com/live.mp4";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          msg: "success",
          note: {
            type: "image",
            title: "Live 图",
            images: [{ url: imageUrl, index: 0, liveVideoUrl }],
          },
        }),
        { status: 200 },
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          msg: "success",
          note: { id: "live123", type: "image", title: "Live 图" },
          files: [
            {
              kind: "image",
              role: "content",
              index: 0,
              path: "/downloads/xhs/live123/image_0.webp",
              name: "image_0.webp",
              mimeType: "image/webp",
            },
            {
              kind: "video",
              role: "live",
              index: 0,
              path: "/downloads/xhs/live123/live_0.mp4",
              name: "live_0.mp4",
              mimeType: "video/mp4",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new SpiderXhsProvider({
      endpoint: "http://127.0.0.1:18061/api/xhs/note",
      downloadEndpoint: "http://127.0.0.1:18061/api/xhs/download",
    });

    const result = await provider.resolve({
      url: "https://www.xiaohongshu.com/explore/live123?xsec_token=ABCD",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18061/api/xhs/download",
      expect.objectContaining({
        body: JSON.stringify({
          url: "https://www.xiaohongshu.com/explore/live123?xsec_token=ABCD",
          mediaTypes: ["image", "video"],
        }),
      }),
    );
    expect(result).toEqual({
      status: "success",
      content: expect.objectContaining({
        htmlContent: expect.stringContaining(`<video src="${liveVideoUrl}"`),
        archivableAssets: [
          {
            kind: "image",
            path: "/downloads/xhs/live123/image_0.webp",
            fileName: "image_0.webp",
            mimeType: "image/webp",
            originalUrl: imageUrl,
            role: "cover",
          },
          {
            kind: "video",
            path: "/downloads/xhs/live123/live_0.mp4",
            fileName: "live_0.mp4",
            mimeType: "video/mp4",
            originalUrl: liveVideoUrl,
            role: "live",
          },
        ],
      }),
    });
  });

  it("fails image notes when Spider_XHS download endpoint is not configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            msg: "success",
            note: {
              type: "image",
              title: "周末咖啡",
              images: [{ url: "https://sns-img.example.com/coffee.jpg" }],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new SpiderXhsProvider({
      endpoint: "http://127.0.0.1:18061/api/xhs/note",
    });

    const result = await provider.resolve({
      url: "https://www.xiaohongshu.com/explore/65f123456789abcdef012345",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "failure",
      retryable: false,
      reason:
        "Spider_XHS download endpoint is required for Xiaohongshu image notes",
    });
  });

  it("recognizes xhslink.cn short links", () => {
    const provider = new SpiderXhsProvider({
      endpoint: "http://127.0.0.1:18061/api/xhs/note",
    });

    expect(provider.canResolve(new URL("https://xhslink.cn/o/abc123"))).toBe(
      true,
    );
  });

  it("returns a non-retryable failure when Spider_XHS reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            msg: "cookie expired",
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new SpiderXhsProvider({
      endpoint: "http://127.0.0.1:18061/api/xhs/note",
    });

    const result = await provider.resolve({
      url: "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "failure",
      retryable: false,
      reason: "Spider_XHS failed: cookie expired",
    });
  });

  it("includes video links in markdown without using remote imageUrl as banner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            errorCode: null,
            msg: "success",
            note: {
              type: "video",
              title: "露营短片",
              desc: "周末记录",
              user: { nickname: "Eric" },
              coverImageUrl: "https://sns-img.example.com/cover.jpg",
              images: [
                {
                  url: "https://sns-img.example.com/cover.jpg",
                  index: 0,
                  width: null,
                  height: null,
                },
              ],
              videos: [
                {
                  url: "https://sns-video.example.com/video.mp4",
                  index: 0,
                  mimeType: "video/mp4",
                  coverUrl: "https://sns-img.example.com/cover.jpg",
                },
              ],
              assets: [
                {
                  kind: "image",
                  url: "https://sns-img.example.com/cover.jpg",
                  index: 0,
                  role: "cover",
                  mimeType: "image/jpeg",
                },
                {
                  kind: "video",
                  url: "https://sns-video.example.com/video.mp4",
                  index: 1,
                  role: "content",
                  mimeType: "video/mp4",
                  coverUrl: "https://sns-img.example.com/cover.jpg",
                },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new SpiderXhsProvider({
      endpoint: "http://127.0.0.1:18061/api/xhs/note",
    });

    const result = await provider.resolve({
      url: "https://www.xiaohongshu.com/explore/video123?xsec_token=ABCD",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "success",
      content: {
        title: "露营短片",
        description: "周末记录",
        author: "Eric",
        imageUrl: null,
        htmlContent:
          "# 露营短片\n\n周末记录\n\n![image 1](https://sns-img.example.com/cover.jpg)\n\n[video 1](https://sns-video.example.com/video.mp4)",
        archivableAssets: [],
        finalUrl:
          "https://www.xiaohongshu.com/explore/video123?xsec_token=ABCD",
      },
    });
  });
});
