import { JSDOM } from "jsdom";

export interface ArchivedReaderImage {
  originalUrl: string;
  assetId: string;
  contentType?: string;
  size?: number;
}

type ArchiveImage = (
  imageUrl: string,
  refererUrl: string,
) => Promise<{
  assetId: string;
  contentType?: string;
  size?: number;
} | null>;

function shouldArchiveImageUrl(value: string) {
  return (
    (value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("/")) &&
    !value.startsWith("/api/assets/")
  );
}

function resolveImageUrl(value: string, pageUrl: string) {
  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return null;
  }
}

export async function archiveReaderImages({
  htmlContent,
  pageUrl,
  archiveImage,
}: {
  htmlContent: string;
  pageUrl: string;
  archiveImage: ArchiveImage;
}): Promise<{
  htmlContent: string;
  archivedAssets: ArchivedReaderImage[];
}> {
  if (!htmlContent) {
    return { htmlContent, archivedAssets: [] };
  }

  const dom = new JSDOM(`<body>${htmlContent}</body>`, { url: pageUrl });
  const images = Array.from(dom.window.document.querySelectorAll("img[src]"));
  const archivedByUrl = new Map<string, string>();
  const archivedAssets: ArchivedReaderImage[] = [];

  for (const image of images) {
    const src = image.getAttribute("src");
    if (!src || !shouldArchiveImageUrl(src)) {
      continue;
    }

    const imageUrl = resolveImageUrl(src, pageUrl);
    if (!imageUrl) {
      continue;
    }

    let assetId = archivedByUrl.get(imageUrl);
    if (!assetId) {
      const archived = await archiveImage(imageUrl, pageUrl);
      if (!archived) {
        continue;
      }
      assetId = archived.assetId;
      archivedByUrl.set(imageUrl, assetId);
      archivedAssets.push({ originalUrl: imageUrl, ...archived });
    }

    image.setAttribute("src", `/api/assets/${assetId}`);
    image.removeAttribute("srcset");
  }

  return {
    htmlContent: dom.window.document.body.innerHTML,
    archivedAssets,
  };
}
