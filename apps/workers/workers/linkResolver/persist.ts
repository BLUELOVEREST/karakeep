import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { updateAsset } from "workerUtils";

import { db } from "@karakeep/db";
import { assets, AssetTypes, bookmarkLinks } from "@karakeep/db/schema";
import { QuotaService } from "@karakeep/shared-server";
import {
  ASSET_TYPES,
  IMAGE_ASSET_TYPES,
  newAssetId,
  saveAssetFromFile,
  silentDeleteAsset,
} from "@karakeep/shared/assetdb";
import serverConfig from "@karakeep/shared/config";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

import {
  archiveWebpage,
  downloadAndStoreImage,
  storeHtmlContent,
} from "../crawler/assetStorage";
import { replaceArchivedAssetUrls } from "./mediaArchive";
import type { RunProxyConfig } from "network";
import type { ResolvedLinkAsset, ResolvedLinkContent } from "./types";

export interface PersistResolvedLinkContentArgs {
  bookmarkId: string;
  userId: string;
  jobId: string;
  sourceUrl: string;
  content: ResolvedLinkContent;
  oldContentAssetId?: string;
  oldImageAssetId?: string;
  oldFullPageArchiveAssetId?: string;
  abortSignal: AbortSignal;
  runProxy: RunProxyConfig;
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeImageContentType(contentType: string | null | undefined) {
  return contentType && IMAGE_ASSET_TYPES.has(contentType)
    ? contentType
    : ASSET_TYPES.IMAGE_JPEG;
}

function absolutizeLocalAssetUrls(htmlContent: string) {
  return htmlContent.replace(
    /\b(src|href)=(["'])(\/api\/assets\/[^"']+)\2/g,
    (_match, attr: string, quote: string, assetUrl: string) =>
      `${attr}=${quote}${new URL(assetUrl, serverConfig.publicUrl).toString()}${quote}`,
  );
}

async function importLocalImageAsset(asset: ResolvedLinkAsset, userId: string) {
  const sourcePath = asset.path;
  if (!sourcePath) {
    return null;
  }

  const assetId = newAssetId();
  const contentType = normalizeImageContentType(asset.mimeType);
  const extension = path.extname(sourcePath);
  const assetPath = path.join("/tmp", `${assetId}${extension}`);
  await fs.promises.copyFile(sourcePath, assetPath);
  const stats = await fs.promises.stat(assetPath);
  const fileBuffer = await fs.promises.readFile(assetPath);
  const quotaApproved = await QuotaService.checkStorageQuota(
    db,
    userId,
    stats.size,
  );
  await saveAssetFromFile({
    userId,
    assetId,
    assetPath,
    metadata: { contentType, fileName: asset.fileName ?? undefined },
    quotaApproved,
  });
  await fs.promises.rm(sourcePath, { force: true });
  return {
    assetId,
    contentType,
    size: stats.size,
    dataUrl: `data:${contentType};base64,${fileBuffer.toString("base64")}`,
  };
}

async function archiveResolvedImageAssets(args: {
  assets: ResolvedLinkAsset[] | undefined;
  userId: string;
  bookmarkId: string;
  jobId: string;
  abortSignal: AbortSignal;
  runProxy: RunProxyConfig;
}) {
  const imageAssets =
    args.assets?.filter(
      (asset) =>
        asset.kind === "image" &&
        ((asset.url && asset.url.startsWith("http")) || asset.path),
    ) ?? [];

  const archivedAssets: {
    originalUrl: string;
    assetUrl: string;
    dbAsset: typeof assets.$inferInsert;
    role: ResolvedLinkAsset["role"];
    dataUrl?: string;
  }[] = [];

  for (const asset of imageAssets) {
    args.abortSignal.throwIfAborted();
    const imported = asset.path
      ? await importLocalImageAsset(asset, args.userId)
      : await downloadAndStoreImage(
          asset.url!,
          args.userId,
          args.jobId,
          args.abortSignal,
          args.runProxy,
        );
    if (!imported) {
      continue;
    }

    const originalUrl = asset.originalUrl ?? asset.url;
    if (!originalUrl) {
      continue;
    }

    archivedAssets.push({
      originalUrl,
      assetUrl: getAssetUrl(imported.assetId),
      role: asset.role,
      dataUrl: "dataUrl" in imported ? imported.dataUrl : undefined,
      dbAsset: {
        id: imported.assetId,
        bookmarkId: args.bookmarkId,
        userId: args.userId,
        assetType:
          asset.role === "cover"
            ? AssetTypes.LINK_BANNER_IMAGE
            : AssetTypes.BOOKMARK_ASSET,
        contentType: imported.contentType,
        size: imported.size,
        fileName: asset.fileName ?? null,
      },
    });
  }

  return archivedAssets;
}

export async function persistResolvedLinkContent(
  args: PersistResolvedLinkContentArgs,
) {
  const archivedImageAssets = await archiveResolvedImageAssets({
    assets: args.content.archivableAssets,
    userId: args.userId,
    bookmarkId: args.bookmarkId,
    jobId: args.jobId,
    abortSignal: args.abortSignal,
    runProxy: args.runProxy,
  });
  const htmlContent = replaceArchivedAssetUrls(
    args.content.htmlContent,
    archivedImageAssets.map((asset) => ({
      originalUrl: asset.originalUrl,
      assetUrl: asset.assetUrl,
    })),
  );

  const htmlContentAssetInfo = await storeHtmlContent(
    htmlContent ?? undefined,
    args.userId,
    args.jobId,
  );
  args.abortSignal.throwIfAborted();

  const archivedBannerAsset = archivedImageAssets.find(
    (asset) => asset.dbAsset.assetType === AssetTypes.LINK_BANNER_IMAGE,
  );
  const imageAssetInfo =
    !archivedBannerAsset &&
    args.content.imageUrl &&
    args.content.imageUrl.startsWith("http")
      ? await downloadAndStoreImage(
          args.content.imageUrl,
          args.userId,
          args.jobId,
          args.abortSignal,
          args.runProxy,
        )
      : null;
  args.abortSignal.throwIfAborted();

  const inlineHtmlContent =
    htmlContentAssetInfo.result === "store_inline"
      ? (htmlContent ?? null)
      : null;
  const assetDeletionTasks: Promise<void>[] = [];

  await db.transaction(async (txn) => {
    await txn
      .update(bookmarkLinks)
      .set({
        url: args.content.finalUrl ?? undefined,
        title: args.content.title,
        description: args.content.description,
        imageUrl: args.content.imageUrl,
        favicon: args.content.favicon,
        author: args.content.author,
        publisher: args.content.publisher,
        datePublished: parseDate(args.content.datePublished),
        dateModified: parseDate(args.content.dateModified),
        htmlContent: inlineHtmlContent,
        contentAssetId:
          htmlContentAssetInfo.result === "stored"
            ? htmlContentAssetInfo.assetId
            : null,
        crawledAt: new Date(),
      })
      .where(eq(bookmarkLinks.id, args.bookmarkId));

    if (htmlContentAssetInfo.result === "stored") {
      await updateAsset(
        args.oldContentAssetId,
        {
          id: htmlContentAssetInfo.assetId,
          bookmarkId: args.bookmarkId,
          userId: args.userId,
          assetType: AssetTypes.LINK_HTML_CONTENT,
          contentType: ASSET_TYPES.TEXT_HTML,
          size: htmlContentAssetInfo.size,
          fileName: null,
        },
        txn,
      );
      assetDeletionTasks.push(
        silentDeleteAsset(args.userId, args.oldContentAssetId),
      );
    }

    if (imageAssetInfo) {
      await updateAsset(
        args.oldImageAssetId,
        {
          id: imageAssetInfo.assetId,
          bookmarkId: args.bookmarkId,
          userId: args.userId,
          assetType: AssetTypes.LINK_BANNER_IMAGE,
          contentType: imageAssetInfo.contentType,
          size: imageAssetInfo.size,
        },
        txn,
      );
      assetDeletionTasks.push(
        silentDeleteAsset(args.userId, args.oldImageAssetId),
      );
    } else if (archivedBannerAsset) {
      await updateAsset(args.oldImageAssetId, archivedBannerAsset.dbAsset, txn);
      assetDeletionTasks.push(
        silentDeleteAsset(args.userId, args.oldImageAssetId),
      );
    }

    const contentAssets = archivedImageAssets
      .filter((asset) => asset !== archivedBannerAsset)
      .map((asset) => asset.dbAsset);
    if (contentAssets.length > 0) {
      await txn.insert(assets).values(contentAssets);
    }
  });

  if (htmlContent && serverConfig.crawler.fullPageArchive) {
    const archiveHtmlContent = replaceArchivedAssetUrls(
      htmlContent,
      archivedImageAssets
        .filter((asset) => asset.dataUrl)
        .map((asset) => ({
          originalUrl: asset.assetUrl,
          assetUrl: asset.dataUrl!,
        })),
    );
    const archiveResult = await archiveWebpage(
      absolutizeLocalAssetUrls(archiveHtmlContent ?? htmlContent),
      args.content.finalUrl ?? args.sourceUrl,
      args.userId,
      args.jobId,
      args.abortSignal,
      args.runProxy,
    );

    if (archiveResult) {
      await db.transaction(async (txn) => {
        await updateAsset(
          args.oldFullPageArchiveAssetId,
          {
            id: archiveResult.assetId,
            bookmarkId: args.bookmarkId,
            userId: args.userId,
            assetType: AssetTypes.LINK_FULL_PAGE_ARCHIVE,
            contentType: archiveResult.contentType,
            size: archiveResult.size,
            fileName: null,
          },
          txn,
        );
      });
      if (args.oldFullPageArchiveAssetId) {
        assetDeletionTasks.push(
          silentDeleteAsset(args.userId, args.oldFullPageArchiveAssetId),
        );
      }
    }
  }

  await Promise.all(assetDeletionTasks);
}

export async function markLinkResolverFailure(
  bookmarkId: string,
  reason: string,
) {
  await db
    .update(bookmarkLinks)
    .set({
      crawlStatus: "failure",
      description: reason,
    })
    .where(eq(bookmarkLinks.id, bookmarkId));
}
