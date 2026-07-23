import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const txn = {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(),
    })),
  };

  return {
    txn,
    db: {
      transaction: vi.fn(async (callback) => callback(txn)),
    },
    archiveWebpage: vi.fn(),
    downloadAndStoreImage: vi.fn(),
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
  },
  IMAGE_ASSET_TYPES: new Set(["image/jpeg", "image/png", "image/webp"]),
  newAssetId: vi.fn(() => "asset-new"),
  saveAssetFromFile: vi.fn(),
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

import { persistResolvedLinkContent } from "./persist";

describe("persistResolvedLinkContent", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("stores a full page archive for resolved link html when full page archive is enabled", async () => {
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
          '<article><p>正文</p><img src="/api/assets/image-1"></article>',
        finalUrl: "https://www.coolapk.com/feed/1",
      },
      abortSignal: new AbortController().signal,
      runProxy: {},
    } as Parameters<typeof persistResolvedLinkContent>[0]);

    expect(mocks.archiveWebpage).toHaveBeenCalledWith(
      '<article><p>正文</p><img src="http://karakeep.test/api/assets/image-1"></article>',
      "https://www.coolapk.com/feed/1",
      "user-1",
      "job-1",
      expect.any(AbortSignal),
      {},
    );
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
});
