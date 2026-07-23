import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isXiaohongshuUrl,
  resolveXiaohongshuMediaDownload,
  selectXiaohongshuDownloadedFiles,
} from "./xiaohongshu";

describe("xiaohongshu media downloader client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects Xiaohongshu note hosts supported by Spider_XHS", () => {
    expect(
      isXiaohongshuUrl("https://www.xiaohongshu.com/explore/note123"),
    ).toBe(true);
    expect(isXiaohongshuUrl("https://xhslink.com/a1b2c3")).toBe(true);
    expect(isXiaohongshuUrl("https://example.com/explore/note123")).toBe(false);
    expect(isXiaohongshuUrl("not a url")).toBe(false);
  });

  it("calls Spider_XHS download endpoint and returns cover and video files", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          errorCode: null,
          msg: "success",
          note: { id: "video123", type: "video", title: "小红书视频" },
          files: [
            {
              kind: "image",
              role: "cover",
              path: "/downloads/video123/cover.jpg",
              name: "cover.jpg",
              mimeType: "image/jpeg",
            },
            {
              kind: "video",
              role: "content",
              path: "/downloads/video123/video.mp4",
              name: "video.mp4",
              mimeType: "video/mp4",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveXiaohongshuMediaDownload({
      endpoint: "http://127.0.0.1:18062/api/xhs/download",
      url: "https://www.xiaohongshu.com/explore/video123",
      abortSignal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18062/api/xhs/download",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: "https://www.xiaohongshu.com/explore/video123",
          mediaTypes: ["image", "video"],
        }),
      }),
    );
    expect(result).toEqual({
      status: "success",
      coverFile: {
        path: "/downloads/video123/cover.jpg",
        name: "cover.jpg",
        mimeType: "image/jpeg",
      },
      videoFile: {
        path: "/downloads/video123/video.mp4",
        name: "video.mp4",
        mimeType: "video/mp4",
      },
      title: "小红书视频",
    });
  });

  it("selects cover and video files from a Spider_XHS download response", () => {
    expect(
      selectXiaohongshuDownloadedFiles({
        note: { title: "小红书视频" },
        files: [
          {
            kind: "image",
            role: "content",
            path: "/downloads/video123/image_0.jpg",
          },
          {
            kind: "image",
            role: "cover",
            path: "/downloads/video123/cover.jpg",
            name: "cover.jpg",
            mimeType: "image/jpeg",
          },
          {
            kind: "video",
            role: "content",
            path: "/downloads/video123/video.mp4",
            name: "video.mp4",
            mimeType: "video/mp4",
          },
        ],
      }),
    ).toEqual({
      coverFile: {
        path: "/downloads/video123/cover.jpg",
        name: "cover.jpg",
        mimeType: "image/jpeg",
      },
      videoFile: {
        path: "/downloads/video123/video.mp4",
        name: "video.mp4",
        mimeType: "video/mp4",
      },
      title: "小红书视频",
    });
  });
});
