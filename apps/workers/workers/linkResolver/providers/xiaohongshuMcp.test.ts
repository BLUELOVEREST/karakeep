import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseXiaohongshuNoteLocator,
  XiaohongshuMcpProvider,
} from "./xiaohongshuMcp";

describe("parseXiaohongshuNoteLocator", () => {
  it("extracts note id and xsec token from an explore URL", () => {
    const locator = parseXiaohongshuNoteLocator(
      "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD&xsec_source=pc_search",
    );

    expect(locator).toEqual({
      feedId: "65f123456789abcdef012345",
      xsecToken: "ABCD",
    });
  });

  it("returns null when the xsec token is missing", () => {
    const locator = parseXiaohongshuNoteLocator(
      "https://www.xiaohongshu.com/explore/65f123456789abcdef012345",
    );

    expect(locator).toBeNull();
  });
});

describe("XiaohongshuMcpProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls get_feed_detail and normalizes note detail into resolved content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  title: "咖啡店记录",
                  desc: "今天发现一家不错的咖啡店",
                  user: { nickname: "Eric" },
                  image_list: [
                    {
                      url: "https://sns-img.example.com/cover.jpg",
                    },
                  ],
                }),
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new XiaohongshuMcpProvider({
      endpoint: "http://127.0.0.1:18060/mcp",
    });

    const result = await provider.resolve({
      url: "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD",
      jobId: "job-1",
      userId: "user-1",
      bookmarkId: "bookmark-1",
      abortSignal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18060/mcp",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("get_feed_detail"),
      }),
    );
    expect(result).toEqual({
      status: "success",
      content: {
        title: "咖啡店记录",
        description: "今天发现一家不错的咖啡店",
        author: "Eric",
        imageUrl: "https://sns-img.example.com/cover.jpg",
        htmlContent:
          "# 咖啡店记录\n\n今天发现一家不错的咖啡店\n\n![image 1](https://sns-img.example.com/cover.jpg)",
        finalUrl:
          "https://www.xiaohongshu.com/explore/65f123456789abcdef012345?xsec_token=ABCD",
      },
    });
  });
});
