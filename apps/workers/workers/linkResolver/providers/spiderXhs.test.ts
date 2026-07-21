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
            title: "周末咖啡",
            desc: "这家店适合安静看书",
            user: { nickname: "Eric" },
            image_list: [
              {
                url: "https://sns-img.example.com/coffee.jpg",
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
        imageUrl: "https://sns-img.example.com/coffee.jpg",
        htmlContent:
          "# 周末咖啡\n\n这家店适合安静看书\n\n![image 1](https://sns-img.example.com/coffee.jpg)",
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
});
