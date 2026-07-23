import fs from "fs";
import * as os from "os";
import path from "path";
import { execa } from "execa";
import { workerStatsCounter } from "metrics";
import {
  getProxyAgent,
  resolveValidatedRedirectUrl,
  selectRunProxies,
} from "network";
import { withWorkerEventLog, withWorkerTracing } from "workerTracing";

import { db } from "@karakeep/db";
import { AssetTypes } from "@karakeep/db/schema";
import {
  addLogFields,
  QuotaService,
  StorageQuotaError,
  VideoWorkerQueue,
  ZVideoRequest,
  zvideoRequestSchema,
} from "@karakeep/shared-server";
import {
  ASSET_TYPES,
  IMAGE_ASSET_TYPES,
  newAssetId,
  saveAssetFromFile,
  silentDeleteAsset,
  VIDEO_ASSET_TYPES,
} from "@karakeep/shared/assetdb";
import serverConfig from "@karakeep/shared/config";
import logger from "@karakeep/shared/logger";
import { DequeuedJob, getQueueClient } from "@karakeep/shared/queueing";

import { getBookmarkDetails, updateAsset } from "../workerUtils";
import {
  isDouyinUrl,
  resolveDouyinVideoDownload,
} from "./videoDownloader/douyin";
import {
  isXiaohongshuUrl,
  resolveXiaohongshuMediaDownload,
} from "./videoDownloader/xiaohongshu";

const TMP_FOLDER = path.join(os.tmpdir(), "video_downloads");

export class VideoWorker {
  static async build() {
    logger.info("Starting video worker ...");

    return (await getQueueClient())!.createRunner<ZVideoRequest>(
      VideoWorkerQueue,
      {
        run: withWorkerTracing(
          "videoWorker.run",
          withWorkerEventLog("videoWorker.run", runWorker),
        ),
        onComplete: async (job) => {
          workerStatsCounter.labels("video", "completed").inc();
          const jobId = job.id;
          logger.info(
            `[VideoCrawler][${jobId}] Video Download Completed successfully`,
          );
          return Promise.resolve();
        },
        onError: async (job) => {
          workerStatsCounter.labels("video", "failed").inc();
          if (job.numRetriesLeft == 0) {
            workerStatsCounter.labels("video", "failed_permanent").inc();
          }
          const jobId = job.id;
          logger.error(
            `[VideoCrawler][${jobId}] Video Download job failed: ${job.error}`,
          );
          return Promise.resolve();
        },
      },
      {
        pollIntervalMs: 1000,
        timeoutSecs: serverConfig.crawler.downloadVideoTimeout,
        concurrency: 1,
        validator: zvideoRequestSchema,
      },
    );
  }
}

function prepareYtDlpArguments(
  url: string,
  proxy: string | undefined,
  assetPath: string,
) {
  // yt-dlp performs its own HTTP requests and can follow redirects that this
  // process cannot validate. Full SSRF protection depends on an egress proxy or
  // network policy that blocks internal/private targets.
  const ytDlpArguments = [url];
  if (serverConfig.crawler.maxVideoDownloadSize > 0) {
    ytDlpArguments.push(
      "-f",
      `best[filesize<${serverConfig.crawler.maxVideoDownloadSize}M]`,
    );
  }

  ytDlpArguments.push(...serverConfig.crawler.ytDlpArguments);
  ytDlpArguments.push("-o", assetPath);
  ytDlpArguments.push("--no-playlist");
  if (proxy) {
    ytDlpArguments.push("--proxy", proxy);
  }
  return ytDlpArguments;
}

function normalizeVideoContentType(contentType: string | null | undefined) {
  return contentType && VIDEO_ASSET_TYPES.has(contentType)
    ? contentType
    : ASSET_TYPES.VIDEO_MP4;
}

function normalizeImageContentType(contentType: string | null | undefined) {
  return contentType && IMAGE_ASSET_TYPES.has(contentType)
    ? contentType
    : ASSET_TYPES.IMAGE_JPEG;
}

async function runWorker(job: DequeuedJob<ZVideoRequest>) {
  const jobId = job.id;
  const { bookmarkId } = job.data;
  addLogFields<"videoWorker.run">({ "bookmark.id": bookmarkId });

  const {
    url,
    userId,
    imageAssetId: oldImageAssetId,
    videoAssetId: oldVideoAssetId,
  } = await getBookmarkDetails(bookmarkId);

  if (!serverConfig.crawler.downloadVideo) {
    logger.info(
      `[VideoCrawler][${jobId}] Skipping video download from "${url}", because it is disabled in the config.`,
    );
    return;
  }

  const videoAssetId = newAssetId();
  let assetPath = `${TMP_FOLDER}/${videoAssetId}`;
  let contentType: string = ASSET_TYPES.VIDEO_MP4;
  await fs.promises.mkdir(TMP_FOLDER, { recursive: true });

  const douyinResolverEndpoint = serverConfig.crawler.douyinResolverEndpoint;
  const xiaohongshuDownloadEndpoint =
    serverConfig.crawler.xiaohongshuSpiderDownloadEndpoint;
  if (xiaohongshuDownloadEndpoint && isXiaohongshuUrl(url)) {
    const resolved = await resolveXiaohongshuMediaDownload({
      endpoint: xiaohongshuDownloadEndpoint,
      url,
      abortSignal: job.abortSignal,
    });

    if (resolved.status === "failure") {
      logger.warn(
        `[VideoCrawler][${jobId}] Skipping Xiaohongshu media download for "${url}": ${resolved.reason}`,
      );
      return;
    }

    if (resolved.coverFile) {
      const imageAssetId = newAssetId();
      const imageContentType = normalizeImageContentType(
        resolved.coverFile.mimeType,
      );
      const sourceExtension = path.extname(resolved.coverFile.path) || ".jpg";
      const imageAssetPath = `${TMP_FOLDER}/${imageAssetId}${sourceExtension}`;
      await fs.promises.copyFile(resolved.coverFile.path, imageAssetPath);
      const imageStats = await fs.promises.stat(imageAssetPath);
      const quotaApproved = await QuotaService.checkStorageQuota(
        db,
        userId,
        imageStats.size,
      );
      await saveAssetFromFile({
        userId,
        assetId: imageAssetId,
        assetPath: imageAssetPath,
        metadata: { contentType: imageContentType },
        quotaApproved,
      });
      await db.transaction(async (txn) => {
        await updateAsset(
          oldImageAssetId,
          {
            id: imageAssetId,
            bookmarkId,
            userId,
            assetType: AssetTypes.LINK_BANNER_IMAGE,
            contentType: imageContentType,
            size: imageStats.size,
          },
          txn,
        );
      });
      await silentDeleteAsset(userId, oldImageAssetId);
      logger.info(
        `[VideoCrawler][${jobId}] Imported Xiaohongshu cover file from "${resolved.coverFile.path}"`,
      );
    }

    if (!resolved.videoFile) {
      logger.info(
        `[VideoCrawler][${jobId}] Spider_XHS did not return a video file for "${url}". Skipping video storage.`,
      );
      return;
    }

    contentType = normalizeVideoContentType(resolved.videoFile.mimeType);
    const sourceExtension = path.extname(resolved.videoFile.path) || ".mp4";
    assetPath = `${TMP_FOLDER}/${videoAssetId}${sourceExtension}`;
    await fs.promises.copyFile(resolved.videoFile.path, assetPath);
    logger.info(
      `[VideoCrawler][${jobId}] Imported Xiaohongshu video file from "${resolved.videoFile.path}" to "${assetPath}"`,
    );
  } else if (douyinResolverEndpoint && isDouyinUrl(url)) {
    const resolved = await resolveDouyinVideoDownload({
      endpoint: douyinResolverEndpoint,
      url,
      abortSignal: job.abortSignal,
      pollIntervalMs: 2000,
      timeoutMs: serverConfig.crawler.downloadVideoTimeout * 1000,
    });

    if (resolved.status === "failure") {
      logger.warn(
        `[VideoCrawler][${jobId}] Skipping Douyin video download for "${url}": ${resolved.reason}`,
      );
      return;
    }

    contentType = normalizeVideoContentType(resolved.file.mimeType);
    const sourceExtension = path.extname(resolved.file.path) || ".mp4";
    assetPath = `${TMP_FOLDER}/${videoAssetId}${sourceExtension}`;
    await fs.promises.copyFile(resolved.file.path, assetPath);
    logger.info(
      `[VideoCrawler][${jobId}] Imported Douyin video file from "${resolved.file.path}" to "${assetPath}"`,
    );
  } else {
    const runProxy = selectRunProxies();
    let normalizedUrl: string;
    try {
      const resolvedUrl = await resolveValidatedRedirectUrl(
        url,
        { signal: job.abortSignal },
        runProxy,
      );
      normalizedUrl = resolvedUrl.toString();
    } catch (error) {
      logger.warn(
        `[VideoCrawler][${jobId}] Skipping video download for "${url}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    const proxy = getProxyAgent(normalizedUrl, runProxy);
    const ytDlpArguments = prepareYtDlpArguments(
      normalizedUrl,
      proxy?.proxy.toString(),
      assetPath,
    );

    try {
      logger.info(
        `[VideoCrawler][${jobId}] Attempting to download a file from "${normalizedUrl}" to "${assetPath}" using the following arguments: "${ytDlpArguments}"`,
      );

      await execa("yt-dlp", ytDlpArguments, {
        cancelSignal: job.abortSignal,
      });
      const downloadPath = await findAssetFile(videoAssetId);
      if (!downloadPath) {
        logger.info(
          "[VideoCrawler][${jobId}] yt-dlp didn't download anything. Skipping ...",
        );
        return;
      }
      assetPath = downloadPath;
    } catch (e) {
      const err = e as Error;
      if (
        err.message.includes("ERROR: Unsupported URL:") ||
        err.message.includes("No media found")
      ) {
        logger.info(
          `[VideoCrawler][${jobId}] Skipping video download from "${normalizedUrl}", because it's not one of the supported yt-dlp URLs`,
        );
        return;
      }
      const genericError = `[VideoCrawler][${jobId}] Failed to download a file from "${normalizedUrl}" to "${assetPath}"`;
      if ("stderr" in err) {
        logger.error(`${genericError}: ${err.stderr}`);
      } else {
        logger.error(genericError);
      }
      await deleteLeftOverAssetFile(jobId, videoAssetId);
      return;
    }
  }

  logger.info(
    `[VideoCrawler][${jobId}] Finished video import to "${assetPath}"`,
  );

  // Get file size and check quota before saving
  const stats = await fs.promises.stat(assetPath);
  const fileSize = stats.size;

  try {
    const quotaApproved = await QuotaService.checkStorageQuota(
      db,
      userId,
      fileSize,
    );

    await saveAssetFromFile({
      userId,
      assetId: videoAssetId,
      assetPath,
      metadata: { contentType },
      quotaApproved,
    });

    await db.transaction(async (txn) => {
      await updateAsset(
        oldVideoAssetId,
        {
          id: videoAssetId,
          bookmarkId,
          userId,
          assetType: AssetTypes.LINK_VIDEO,
          contentType,
          size: fileSize,
        },
        txn,
      );
    });
    await silentDeleteAsset(userId, oldVideoAssetId);

    logger.info(
      `[VideoCrawler][${jobId}] Finished downloading video from "${url}" and adding it to the database`,
    );
  } catch (error) {
    if (error instanceof StorageQuotaError) {
      logger.warn(
        `[VideoCrawler][${jobId}] Skipping video storage due to quota exceeded: ${error.message}`,
      );
      await deleteLeftOverAssetFile(jobId, videoAssetId);
      return;
    }
    throw error;
  }
}

/**
 * Deletes leftover assets in case the download fails
 *
 * @param jobId the id of the job
 * @param assetId the id of the asset to delete
 */
async function deleteLeftOverAssetFile(
  jobId: string,
  assetId: string,
): Promise<void> {
  let assetFile;
  try {
    assetFile = await findAssetFile(assetId);
  } catch {
    // ignore exception, no asset file was found
    return;
  }
  if (!assetFile) {
    return;
  }
  logger.info(
    `[VideoCrawler][${jobId}] Deleting leftover video asset "${assetFile}".`,
  );
  try {
    await fs.promises.rm(assetFile);
  } catch {
    logger.error(
      `[VideoCrawler][${jobId}] Failed deleting leftover video asset "${assetFile}".`,
    );
  }
}

/**
 * yt-dlp automatically adds a file ending to the passed in filename --> we have to search it again in the folder
 *
 * @param assetId the id of the asset to search
 * @returns the path to the downloaded asset
 */
async function findAssetFile(assetId: string): Promise<string | null> {
  const files = await fs.promises.readdir(TMP_FOLDER);
  for (const file of files) {
    if (file.startsWith(assetId)) {
      return path.join(TMP_FOLDER, file);
    }
  }
  return null;
}
