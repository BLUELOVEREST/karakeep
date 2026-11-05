import { beforeEach, describe, expect, it, vi } from "vitest";

import { StorageQuotaError } from "@karakeep/shared-server";

import { runVideoJob } from "./videoWorker";

const mocks = vi.hoisted(() => ({
  url: "https://example.com/video",
  execute: vi.fn(),
  quota: vi.fn(),
  xhs: vi.fn(),
}));
vi.mock("fs", () => ({
  default: {
    promises: {
      mkdir: vi.fn(),
      readdir: async () => ["new-video.mp4"],
      stat: async () => ({ size: 10 }),
      unlink: vi.fn(),
      copyFile: vi.fn(),
    },
  },
}));
vi.mock("execa", () => ({ execa: mocks.execute }));
vi.mock("metrics", () => ({ workerStatsCounter: {} }));
vi.mock("workerTracing", () => ({
  withWorkerEventLog: vi.fn(),
  withWorkerTracing: vi.fn(),
}));
vi.mock("network", () => ({
  selectRunProxies: () => ({}),
  getProxyAgent: () => null,
  resolveValidatedRedirectUrl: async (url: string) => new URL(url),
}));
vi.mock("../workerUtils", () => ({
  getBookmarkDetails: async () => ({ url: mocks.url, userId: "owner" }),
  updateAsset: vi.fn(),
}));
vi.mock("@karakeep/db", () => ({
  db: { transaction: async (fn: (tx: unknown) => unknown) => fn({}) },
}));
vi.mock("@karakeep/shared-server", () => ({
  ASSET_TYPES: { VIDEO_MP4: "video/mp4", IMAGE_JPEG: "image/jpeg" },
  newAssetId: () => "new-video",
  addLogFields: vi.fn(),
  QuotaService: { checkStorageQuota: mocks.quota },
  saveAssetFromFile: vi.fn(),
  silentDeleteAsset: vi.fn(),
  VideoWorkerQueue: {},
  zvideoRequestSchema: {},
  CaptureEvents: class {},
  StorageQuotaError: class extends Error {},
}));
vi.mock("@karakeep/shared/config", async (original) => {
  const mod = await original<typeof import("@karakeep/shared/config")>();
  return {
    default: {
      ...mod.default,
      crawler: {
        ...mod.default.crawler,
        downloadVideo: true,
        downloadVideoOnDemand: true,
        xiaohongshuSpiderDownloadEndpoint: "http://resolver.test/download",
        maxVideoDownloadSize: 0,
        ytDlpArguments: [],
      },
    },
  };
});
vi.mock("./videoDownloader/xiaohongshu", async (original) => ({
  ...(await original<typeof import("./videoDownloader/xiaohongshu")>()),
  resolveXiaohongshuMediaDownload: mocks.xhs,
}));

beforeEach(() => {
  mocks.url = "https://example.com/video";
  mocks.execute.mockReset();
  mocks.execute.mockResolvedValue({});
  mocks.quota.mockReset();
  mocks.quota.mockResolvedValue(true);
  mocks.xhs.mockReset();
});
const job = () => ({
  id: "video-job",
  data: { bookmarkId: "bookmark", url: mocks.url },
  runNumber: 1,
  priority: 0,
  abortSignal: new AbortController().signal,
});

describe("video lifecycle outcomes", () => {
  it("reports downloader failures, not successful media completion", async () => {
    mocks.execute.mockRejectedValue(new Error("network connection failed"));
    expect(await runVideoJob(job())).toMatchObject({
      status: "failed",
      error: { code: "NETWORK_ERROR" },
    });
  });
  it("reports resolver authentication failures", async () => {
    mocks.url = "https://www.xiaohongshu.com/explore/example";
    mocks.xhs.mockResolvedValue({
      status: "failure",
      retryable: false,
      reason: "COOKIE_EXPIRED: cookie expired",
    });
    expect(await runVideoJob(job())).toMatchObject({
      status: "failed",
      error: { code: "COOKIE_EXPIRED" },
    });
  });
  it("distinguishes optional unsupported-video skips from download failures", async () => {
    mocks.execute.mockRejectedValue(
      new Error("ERROR: Unsupported URL: https://example.com"),
    );
    expect(await runVideoJob(job())).toEqual({ status: "skipped" });
  });
  it("reports storage quota failure without claiming recovery", async () => {
    mocks.quota.mockRejectedValue(new StorageQuotaError(10, 10, 10));
    expect(await runVideoJob(job())).toMatchObject({
      status: "failed",
      error: { code: "STORAGE_QUOTA_EXCEEDED" },
    });
  });
  it("reports stored media explicitly", async () => {
    expect(await runVideoJob(job())).toEqual({ status: "stored" });
  });
});
