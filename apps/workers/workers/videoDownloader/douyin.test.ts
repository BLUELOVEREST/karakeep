import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isDouyinUrl,
  resolveDouyinVideoDownload,
  selectDouyinVideoFile,
} from "./douyin";

describe("douyin video downloader client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects Douyin hosts supported by the external resolver", () => {
    expect(isDouyinUrl("https://www.douyin.com/video/123")).toBe(true);
    expect(isDouyinUrl("https://v.douyin.com/abc123/")).toBe(true);
    expect(isDouyinUrl("https://v.iesdouyin.com/abc123/")).toBe(true);
    expect(isDouyinUrl("https://example.com/video/123")).toBe(false);
    expect(isDouyinUrl("not a url")).toBe(false);
  });

  it("creates a Douyin job, polls it, and returns the first downloaded video file", async () => {
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
            url: "https://v.douyin.com/abc123/",
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
            status: "running",
            url: "https://v.douyin.com/abc123/",
            result: null,
            error: null,
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

    const result = await resolveDouyinVideoDownload({
      endpoint: "http://127.0.0.1:18064/api/karakeep/v1/douyin",
      url: "https://v.douyin.com/abc123/",
      abortSignal: new AbortController().signal,
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:18064/api/karakeep/v1/douyin/download",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://v.douyin.com/abc123/" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:18064/api/karakeep/v1/douyin/jobs/job-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual({
      status: "success",
      file: {
        path: "/downloads/item.mp4",
        name: "item.mp4",
        mimeType: "video/mp4",
      },
      title: "抖音标题",
    });
  });

  it("returns a retryable failure when the Douyin job fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true, jobId: "job-1" }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: false,
              jobId: "job-1",
              status: "failed",
              reason: "DOWNLOAD_FAILED",
              message: "download failed",
              retryable: true,
            }),
            { status: 200 },
          ),
        ),
    );

    const result = await resolveDouyinVideoDownload({
      endpoint: "http://127.0.0.1:18064/api/karakeep/v1/douyin/",
      url: "https://www.douyin.com/video/123",
      abortSignal: new AbortController().signal,
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    expect(result).toEqual({
      status: "failure",
      retryable: true,
      reason: "Douyin resolver failed: DOWNLOAD_FAILED: download failed",
    });
  });

  it("selects only video files from completed Douyin items", () => {
    expect(
      selectDouyinVideoFile({
        items: [
          {
            title: "图文",
            files: [{ type: "image", path: "/downloads/one.jpg" }],
          },
          {
            title: "视频",
            files: [
              {
                type: "video",
                path: "/downloads/two.mp4",
                name: "two.mp4",
                mimeType: "video/mp4",
              },
            ],
          },
        ],
      }),
    ).toEqual({
      file: {
        path: "/downloads/two.mp4",
        name: "two.mp4",
        mimeType: "video/mp4",
      },
      title: "视频",
    });
  });
});
