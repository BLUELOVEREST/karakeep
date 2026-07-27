import type {
  LinkResolverInput,
  LinkResolverProvider,
  LinkResolverResult,
  ResolvedLinkAsset,
} from "../types";

export interface SpiderXhsProviderOptions {
  endpoint: string;
  downloadEndpoint?: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function extractImageItems(note: UnknownRecord): {
  url: string;
  liveVideoUrl?: string;
}[] {
  const imageList = note.images ?? note.image_list;
  if (!Array.isArray(imageList)) {
    return [];
  }
  return imageList
    .map((image) => {
      const record = asRecord(image);
      return (
        asString(record?.url) ??
        asString(record?.url_default) ??
        asString(record?.url_pre)
      );
    })
    .filter((url): url is string => !!url?.startsWith("http"))
    .map((url, index) => {
      const record = asRecord(imageList[index]);
      const liveVideoUrl = asString(record?.liveVideoUrl);
      return liveVideoUrl?.startsWith("http") ? { url, liveVideoUrl } : { url };
    });
}

function extractVideoUrls(note: UnknownRecord): string[] {
  const videos = note.videos;
  if (Array.isArray(videos)) {
    return videos
      .map((video) => asString(asRecord(video)?.url))
      .filter((url): url is string => !!url?.startsWith("http"));
  }

  const legacyVideoUrl = asString(asRecord(note.video)?.url);
  return legacyVideoUrl?.startsWith("http") ? [legacyVideoUrl] : [];
}

function buildMarkdown(
  title: string | null,
  description: string | null,
  imageUrls: string[],
  videoUrls: string[],
) {
  const blocks: string[] = [];
  if (title) {
    blocks.push(`# ${title}`);
  }
  if (description) {
    blocks.push(description);
  }
  imageUrls.forEach((imageUrl, index) => {
    blocks.push(`![image ${index + 1}](${imageUrl})`);
  });
  videoUrls.forEach((videoUrl, index) => {
    blocks.push(`[video ${index + 1}](${videoUrl})`);
  });
  return blocks.join("\n\n") || null;
}

function buildXiaohongshuImageHtml(
  title: string | null,
  description: string | null,
  author: string | null,
  imageItems: { url: string; liveVideoUrl?: string }[],
) {
  const imageSlides = imageItems
    .map((image, index) => {
      const imageUrl = image.url;
      const escapedUrl = escapeHtmlAttribute(imageUrl);
      if (image.liveVideoUrl) {
        const escapedVideoUrl = escapeHtmlAttribute(image.liveVideoUrl);
        return `<figure class="xhs-slide xhs-live-slide"><video src="${escapedVideoUrl}" poster="${escapedUrl}" aria-label="小红书 live 图 ${index + 1}" muted loop playsinline autoplay preload="metadata"></video></figure>`;
      }
      return `<figure class="xhs-slide"><img src="${escapedUrl}" alt="小红书图片 ${index + 1}" loading="lazy" /></figure>`;
    })
    .join("");

  const titleHtml = title
    ? `<h1 class="xhs-title">${escapeHtml(title)}</h1>`
    : "";
  const authorHtml = author
    ? `<p class="xhs-author">${escapeHtml(author)}</p>`
    : "";
  const descriptionHtml = description
    ? `<div class="xhs-desc">${escapeHtml(description).replace(/\n/g, "<br>")}</div>`
    : "";

  return `<style>
.xhs-note{max-width:760px;margin:0 auto;color:inherit}
.xhs-gallery{display:flex;gap:16px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type: x mandatory;padding:4px 0 18px;margin:0 0 24px;-webkit-overflow-scrolling:touch}
.xhs-slide{flex:0 0 min(88%,520px);scroll-snap-align:center;margin:0;border-radius:18px;overflow:hidden;background:rgba(127,127,127,.08)}
.xhs-slide img,.xhs-slide video{display:block;width:100%;height:auto;max-height:72vh;object-fit:contain;margin:0 auto}
.xhs-body{max-width:680px;margin:0 auto}
.xhs-title{margin:0 0 10px;font-size:1.45em;line-height:1.35}
.xhs-author{margin:0 0 18px;color:color-mix(in srgb,currentColor 62%,transparent);font-size:.95em}
.xhs-desc{white-space:normal;line-height:1.85}
@media (max-width:640px){.xhs-slide{flex-basis:92%}.xhs-gallery{gap:12px}}
</style><article class="xhs-note"><section class="xhs-gallery">${imageSlides}</section><section class="xhs-body">${titleHtml}${authorHtml}${descriptionHtml}</section></article>`;
}

async function downloadImageAssets(args: {
  endpoint: string;
  url: string;
  imageItems: { url: string; liveVideoUrl?: string }[];
  abortSignal: AbortSignal;
}): Promise<
  | {
      status: "success";
      assets: ResolvedLinkAsset[];
    }
  | {
      status: "failure";
      retryable: boolean;
      reason: string;
    }
> {
  const response = await fetch(args.endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: args.url,
      mediaTypes: args.imageItems.some((image) => image.liveVideoUrl)
        ? ["image", "video"]
        : ["image"],
    }),
    signal: args.abortSignal,
  });

  if (!response.ok) {
    return {
      status: "failure",
      retryable: response.status >= 500,
      reason: `Spider_XHS download endpoint returned HTTP ${response.status}`,
    };
  }

  const payload = asRecord(await response.json());
  if (!payload) {
    return {
      status: "failure",
      retryable: false,
      reason: "Spider_XHS download response is not an object",
    };
  }

  if (payload.success !== true) {
    const errorCode = asString(payload.errorCode) ?? "UNKNOWN";
    const msg = asString(payload.msg) ?? "unknown error";
    return {
      status: "failure",
      retryable:
        errorCode === "UPSTREAM_ERROR" || errorCode === "DOWNLOAD_FAILED",
      reason: `Spider_XHS image download failed: ${errorCode}: ${msg}`,
    };
  }

  const files = Array.isArray(payload.files) ? payload.files : [];
  const imageFiles = files
    .map((file) => asRecord(file))
    .filter((file): file is UnknownRecord => {
      return file?.kind === "image" && !!asString(file.path);
    })
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));

  if (imageFiles.length < args.imageItems.length) {
    return {
      status: "failure",
      retryable: false,
      reason: "Spider_XHS did not download all Xiaohongshu image assets",
    };
  }

  return {
    status: "success",
    assets: args.imageItems.flatMap((image, index) => {
      const file = imageFiles[index];
      const assets: ResolvedLinkAsset[] = [
        {
          kind: "image" as const,
          path: asString(file.path),
          fileName: asString(file.name),
          mimeType: asString(file.mimeType),
          originalUrl: image.url,
          role: index === 0 ? ("cover" as const) : ("content" as const),
        },
      ];
      if (image.liveVideoUrl) {
        const videoFile = files
          .map((file) => asRecord(file))
          .find(
            (file) =>
              file?.kind === "video" &&
              file.role === "live" &&
              Number(file.index ?? 0) === index &&
              !!asString(file.path),
          );
        if (videoFile) {
          assets.push({
            kind: "video" as const,
            path: asString(videoFile.path),
            fileName: asString(videoFile.name),
            mimeType: asString(videoFile.mimeType),
            originalUrl: image.liveVideoUrl,
            role: "live" as const,
          });
        }
      }
      return assets;
    }),
  };
}

export class SpiderXhsProvider implements LinkResolverProvider {
  id = "spider-xhs";
  fallbackPolicy = "fail_fast" as const;

  constructor(private readonly options: SpiderXhsProviderOptions) {}

  canResolve(url: URL): boolean {
    return (
      url.hostname === "xiaohongshu.com" ||
      url.hostname.endsWith(".xiaohongshu.com") ||
      url.hostname === "xhslink.com" ||
      url.hostname.endsWith(".xhslink.com") ||
      url.hostname === "xhslink.cn" ||
      url.hostname.endsWith(".xhslink.cn")
    );
  }

  async resolve(input: LinkResolverInput): Promise<LinkResolverResult> {
    const response = await fetch(this.options.endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: input.url }),
      signal: input.abortSignal,
    });

    if (!response.ok) {
      return {
        status: "failure",
        retryable: response.status >= 500,
        reason: `Spider_XHS returned HTTP ${response.status}`,
      };
    }

    const payload = asRecord(await response.json());
    if (!payload) {
      return {
        status: "failure",
        retryable: false,
        reason: "Spider_XHS response is not an object",
      };
    }

    if (payload.success !== true) {
      return {
        status: "failure",
        retryable: false,
        reason: `Spider_XHS failed: ${asString(payload.msg) ?? "unknown error"}`,
      };
    }

    const note = asRecord(payload.note);
    if (!note) {
      return {
        status: "failure",
        retryable: false,
        reason: "Spider_XHS response did not contain note",
      };
    }

    const title = asString(note.title);
    const description =
      asString(note.desc) ??
      asString(note.description) ??
      asString(note.content);
    const author = asString(asRecord(note.user)?.nickname);
    const imageItems = extractImageItems(note);
    const imageUrls = imageItems.map((image) => image.url);
    const videoUrls = extractVideoUrls(note);
    const noteType = asString(note.type);
    let archivableAssets: ResolvedLinkAsset[] = [];
    const htmlContent =
      noteType === "video"
        ? buildMarkdown(title, description, imageUrls, videoUrls)
        : buildXiaohongshuImageHtml(title, description, author, imageItems);

    if (noteType !== "video" && imageUrls.length > 0) {
      if (!this.options.downloadEndpoint) {
        return {
          status: "failure",
          retryable: false,
          reason:
            "Spider_XHS download endpoint is required for Xiaohongshu image notes",
        };
      }

      const downloadedAssets = await downloadImageAssets({
        endpoint: this.options.downloadEndpoint,
        url: input.url,
        imageItems,
        abortSignal: input.abortSignal,
      });
      if (downloadedAssets.status === "failure") {
        return downloadedAssets;
      }
      archivableAssets = downloadedAssets.assets;
    }

    return {
      status: "success",
      content: {
        title,
        description,
        author,
        imageUrl: null,
        htmlContent,
        archivableAssets,
        finalUrl: input.url,
        ...(noteType !== "video" ? { skipVideoDownload: true } : {}),
      },
    };
  }
}
