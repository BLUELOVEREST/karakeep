export interface ArchivedAssetUrl {
  originalUrl: string;
  assetUrl: string;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceArchivedAssetUrls(
  htmlContent: string | null | undefined,
  archivedAssets: ArchivedAssetUrl[],
): string | null | undefined {
  if (!htmlContent || archivedAssets.length === 0) {
    return htmlContent;
  }

  let replaced = htmlContent;
  for (const asset of archivedAssets) {
    replaced = replaced.replace(
      new RegExp(escapeRegExp(asset.originalUrl), "g"),
      asset.assetUrl,
    );
  }
  return replaced;
}
