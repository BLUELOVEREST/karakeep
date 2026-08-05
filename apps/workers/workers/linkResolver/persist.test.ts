import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => {
  const run = vi.fn();
  const txn = {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ run })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ run })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({ run })),
    })),
  };

  return {
    run,
    txn,
    updateSet: vi.fn(() => ({
      where: vi.fn(),
    })),
    db: {
      transaction: vi.fn(async (callback) => callback(txn)),
      update: vi.fn(),
    },
    archiveWebpage: vi.fn(),
    downloadAndStoreImage: vi.fn(),
    saveAsset: vi.fn(),
    storeHtmlContent: vi.fn(),
    updateAsset: vi.fn(),
    silentDeleteAsset: vi.fn(),
  };
});

vi.mock("@karakeep/db", () => ({
  db: mocks.db,
}));

vi.mock("@karakeep/shared/config", () => ({
  default: {
    publicUrl: "http://karakeep.test",
    crawler: {
      fullPageArchive: true,
    },
  },
}));

vi.mock("@karakeep/shared-server", () => ({
  QuotaService: {
    checkStorageQuota: vi.fn(),
  },
}));

vi.mock("@karakeep/shared/assetdb", () => ({
  ASSET_TYPES: {
    IMAGE_JPEG: "image/jpeg",
    TEXT_HTML: "text/html",
    VIDEO_MP4: "video/mp4",
  },
  IMAGE_ASSET_TYPES: new Set(["image/jpeg", "image/png", "image/webp"]),
  VIDEO_ASSET_TYPES: new Set(["video/mp4"]),
  newAssetId: vi.fn(() => "asset-new"),
  saveAsset: mocks.saveAsset,
  silentDeleteAsset: mocks.silentDeleteAsset,
}));

vi.mock("workerUtils", () => ({
  updateAsset: mocks.updateAsset,
}));

vi.mock("../crawler/assetStorage", () => ({
  archiveWebpage: mocks.archiveWebpage,
  downloadAndStoreImage: mocks.downloadAndStoreImage,
  storeHtmlContent: mocks.storeHtmlContent,
}));

import { AssetTypes } from "@karakeep/db/schema";

import { markLinkResolverFailure, persistResolvedLinkContent } from "./persist";

describe("persistResolvedLinkContent", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.db.update.mockReturnValue({ set: mocks.updateSet });
  });

  it("stores a self-contained full page archive for resolved link html when full page archive is enabled", async () => {
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "karakeep-resolver-asset-"),
    );
    const localImagePath = path.join(tempDir, "image.png");
    await fs.promises.writeFile(localImagePath, Buffer.from("image-bytes"));

    mocks.storeHtmlContent.mockResolvedValue({ result: "store_inline" });
    mocks.archiveWebpage.mockResolvedValue({
      assetId: "archive-new",
      contentType: "text/html",
      size: 123,
    });

    await persistResolvedLinkContent({
      bookmarkId: "bookmark-1",
      userId: "user-1",
      jobId: "job-1",
      sourceUrl: "https://www.coolapk.com/feed/1",
      oldFullPageArchiveAssetId: "archive-old",
      content: {
        title: "酷安标题",
        htmlContent:
          '<article><p>正文</p><img src="https://image.test/image.png"></article>',
        finalUrl: "https://www.coolapk.com/feed/1",
        archivableAssets: [
          {
            kind: "image",
            path: localImagePath,
            originalUrl: "https://image.test/image.png",
            fileName: "image.png",
            mimeType: "image/png",
            role: "cover",
          },
        ],
      },
      abortSignal: new AbortController().signal,
      runProxy: {},
    } as Parameters<typeof persistResolvedLinkContent>[0]);

    expect(mocks.archiveWebpage).toHaveBeenCalledWith(
      '<!doctype html><html><head><meta charset="utf-8"><style>html{box-sizing:border-box}*,*:before,*:after{box-sizing:inherit}body{margin:0;padding:32px 18px;background:#fff;color:#111;font:16px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}article{max-width:760px;margin:0 auto}img,video{display:block;max-width:100%;height:auto;margin:16px auto}figure{margin:24px 0}figcaption{margin-top:8px;color:#666;font-size:14px;text-align:center}pre,code{white-space:pre-wrap;word-break:break-word}a{color:#0969da}</style></head><body><article><p>正文</p><img src="data:image/png;base64,aW1hZ2UtYnl0ZXM="></article></body></html>',
      "https://www.coolapk.com/feed/1",
      "user-1",
      "job-1",
      expect.any(AbortSignal),
      {},
    );
    expect(mocks.saveAsset).toHaveBeenCalledWith({
      userId: "user-1",
      assetId: "asset-new",
      asset: Buffer.from("image-bytes"),
      metadata: { contentType: "image/png", fileName: "image.png" },
      quotaApproved: undefined,
    });
    expect(mocks.updateAsset).toHaveBeenCalledWith(
      "archive-old",
      expect.objectContaining({
        id: "archive-new",
        bookmarkId: "bookmark-1",
        userId: "user-1",
        assetType: AssetTypes.LINK_FULL_PAGE_ARCHIVE,
        contentType: "text/html",
        size: 123,
      }),
      mocks.txn,
    );
    expect(mocks.silentDeleteAsset).toHaveBeenCalledWith(
      "user-1",
      "archive-old",
    );
  });

  it("archives local resolved video assets referenced from html", async () => {
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "karakeep-resolver-video-"),
    );
    const localVideoPath = path.join(tempDir, "live_0.mp4");
    await fs.promises.writeFile(localVideoPath, Buffer.from("video-bytes"));

    mocks.storeHtmlContent.mockResolvedValue({ result: "store_inline" });
    mocks.archiveWebpage.mockResolvedValue({
      assetId: "archive-new",
      contentType: "text/html",
      size: 123,
    });

    await persistResolvedLinkContent({
      bookmarkId: "bookmark-1",
      userId: "user-1",
      jobId: "job-1",
      sourceUrl: "https://www.xiaohongshu.com/explore/1",
      oldFullPageArchiveAssetId: "archive-old",
      content: {
        title: "Live 图",
        htmlContent:
          '<article><video src="https://video.test/live.mp4"></video></article>',
        finalUrl: "https://www.xiaohongshu.com/explore/1",
        archivableAssets: [
          {
            kind: "video",
            path: localVideoPath,
            originalUrl: "https://video.test/live.mp4",
            fileName: "live_0.mp4",
            mimeType: "video/mp4",
            role: "live",
          },
        ],
      },
      abortSignal: new AbortController().signal,
      runProxy: {},
    } as Parameters<typeof persistResolvedLinkContent>[0]);

    expect(mocks.archiveWebpage).toHaveBeenCalledWith(
      '<!doctype html><html><head><meta charset="utf-8"><style>html{box-sizing:border-box}*,*:before,*:after{box-sizing:inherit}body{margin:0;padding:32px 18px;background:#fff;color:#111;font:16px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}article{max-width:760px;margin:0 auto}img,video{display:block;max-width:100%;height:auto;margin:16px auto}figure{margin:24px 0}figcaption{margin-top:8px;color:#666;font-size:14px;text-align:center}pre,code{white-space:pre-wrap;word-break:break-word}a{color:#0969da}</style></head><body><article><video src="data:video/mp4;base64,dmlkZW8tYnl0ZXM="></video></article></body></html>',
      "https://www.xiaohongshu.com/explore/1",
      "user-1",
      "job-1",
      expect.any(AbortSignal),
      {},
    );
  });

  it("stores a primary local resolved video asset as the bookmark video", async () => {
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "karakeep-resolver-primary-video-"),
    );
    const localVideoPath = path.join(tempDir, "video.mp4");
    await fs.promises.writeFile(localVideoPath, Buffer.from("video-bytes"));

    mocks.storeHtmlContent.mockResolvedValue({ result: "store_inline" });
    mocks.archiveWebpage.mockResolvedValue(null);

    await persistResolvedLinkContent({
      bookmarkId: "bookmark-1",
      userId: "user-1",
      jobId: "job-1",
      sourceUrl: "https://www.douyin.com/video/123",
      oldVideoAssetId: "video-old",
      content: {
        title: "抖音视频",
        htmlContent:
          '<article><video src="/downloads/video.mp4"></video></article>',
        finalUrl: "https://www.douyin.com/video/123",
        archivableAssets: [
          {
            kind: "video",
            path: localVideoPath,
            originalUrl: "/downloads/video.mp4",
            fileName: "video.mp4",
            mimeType: "video/mp4",
            role: "content",
          },
        ],
      },
      abortSignal: new AbortController().signal,
      runProxy: {},
    } as Parameters<typeof persistResolvedLinkContent>[0]);

    expect(mocks.updateAsset).toHaveBeenCalledWith(
      "video-old",
      expect.objectContaining({
        bookmarkId: "bookmark-1",
        userId: "user-1",
        assetType: AssetTypes.LINK_VIDEO,
        contentType: "video/mp4",
        fileName: "video.mp4",
      }),
      mocks.txn,
    );
  });
});

describe("markLinkResolverFailure", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.db.update.mockReturnValue({ set: mocks.updateSet });
  });

  it("persists structured resolver crawl errors", async () => {
    await markLinkResolverFailure("bookmark-1", {
      source: "link_resolver",
      code: "COOKIE_EXPIRED",
      message: "[spider-xhs] Spider_XHS failed: cookie expired",
      retryable: false,
    });

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        crawlStatus: "failure",
        description: "[spider-xhs] Spider_XHS failed: cookie expired",
        crawlErrorSource: "link_resolver",
        crawlErrorCode: "COOKIE_EXPIRED",
        crawlErrorMessage: "[spider-xhs] Spider_XHS failed: cookie expired",
        crawlErrorRetryable: false,
        crawlErrorAt: expect.any(Date),
      }),
    );
  });
});
