export interface ArchivedAssetUrl {
  originalUrl: string;
  assetUrl: string;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    const urlVariants = new Set([
      asset.originalUrl,
      escapeHtmlAttribute(asset.originalUrl),
    ]);
    for (const originalUrl of urlVariants) {
      replaced = replaced.replace(
        new RegExp(escapeRegExp(originalUrl), "g"),
        asset.assetUrl,
      );
    }
  }
  return replaced;
}
