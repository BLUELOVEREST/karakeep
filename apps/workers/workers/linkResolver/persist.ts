import { eq } from "drizzle-orm";
import { updateAsset } from "workerUtils";

import { db } from "@karakeep/db";
import { AssetTypes, bookmarkLinks } from "@karakeep/db/schema";
import { ASSET_TYPES, silentDeleteAsset } from "@karakeep/shared/assetdb";

import {
  downloadAndStoreImage,
  storeHtmlContent,
} from "../crawler/assetStorage";
import type { RunProxyConfig } from "network";
import type { ResolvedLinkContent } from "./types";

export interface PersistResolvedLinkContentArgs {
  bookmarkId: string;
  userId: string;
  jobId: string;
  content: ResolvedLinkContent;
  oldContentAssetId?: string;
  oldImageAssetId?: string;
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

export async function persistResolvedLinkContent(
  args: PersistResolvedLinkContentArgs,
) {
  const htmlContentAssetInfo = await storeHtmlContent(
    args.content.htmlContent ?? undefined,
    args.userId,
    args.jobId,
  );
  args.abortSignal.throwIfAborted();

  const imageAssetInfo =
    args.content.imageUrl && args.content.imageUrl.startsWith("http")
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
      ? (args.content.htmlContent ?? null)
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
    }
  });

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
