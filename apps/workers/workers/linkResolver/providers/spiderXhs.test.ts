import { afterEach, describe, expect, it, vi } from "vitest";

import { SpiderXhsProvider } from "./spiderXhs";

describe("SpiderXhsProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the Spider_XHS wrapper service and normalizes note info", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
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
                url: "https://sns-img.example.com/coffee.jpg",
                index: 0,
                width: null,
                height: null,
              },
            ],
            assets: [
              {
                kind: "image",
                url: "https://sns-img.example.com/coffee.jpg",
                index: 0,
                role: "content",
                mimeType: "image/jpeg",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

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

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18061/api/xhs/note",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD",
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
        htmlContent:
          "# 周末咖啡\n\n这家店适合安静看书\n\n![image 1](https://sns-img.example.com/coffee.jpg)",
        archivableAssets: [
          {
            kind: "image",
            url: "https://sns-img.example.com/coffee.jpg",
            originalUrl: "https://sns-img.example.com/coffee.jpg",
            role: "cover",
          },
        ],
        finalUrl:
          "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD",
      },
    });
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
