import type {
  LinkResolverInput,
  LinkResolverProvider,
  LinkResolverResult,
} from "../types";

export interface WechatArticleProviderOptions {
  endpoint: string;
  authKey?: string;
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

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asDate(value: unknown): Date | null {
  const raw = asString(value);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function extractImageUrls(payload: UnknownRecord): string[] {
  const imageUrls: string[] = [];
  const coverImageUrl = asString(payload.coverImageUrl);
  if (coverImageUrl?.startsWith("http")) {
    imageUrls.push(coverImageUrl);
  }

  const images = payload.images;
  if (Array.isArray(images)) {
    for (const image of images) {
      const record = asRecord(image);
      const url = asString(record?.url) ?? asString(record?.originalUrl);
      if (url?.startsWith("http")) {
        imageUrls.push(url);
      }
    }
  }

  return [...new Set(imageUrls)];
}

function extractDownloadedImageAssets(payload: UnknownRecord) {
  const assets: {
    kind: "image";
    path: string;
    originalUrl: string;
    fileName?: string | null;
    mimeType?: string | null;
    role?: "cover" | "content" | null;
  }[] = [];

  const coverImage = asRecord(payload.coverImage);
  if (coverImage) {
    const coverAsset = downloadedAssetFromRecord(coverImage, "cover");
    if (coverAsset) {
      assets.push(coverAsset);
    }
  }

  const images = payload.images;
  if (Array.isArray(images)) {
    for (const image of images) {
      const record = asRecord(image);
      if (!record) {
        continue;
      }
      const asset = downloadedAssetFromRecord(record, "content");
      if (asset) {
        assets.push(asset);
      }
    }
  }

  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.originalUrl}:${asset.path}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function downloadedAssetFromRecord(
  record: UnknownRecord,
  fallbackRole: "cover" | "content",
) {
  const originalUrl =
    asString(record.url) ??
    asString(record.originalUrl) ??
    asString(record.original_url);
  const localPath =
    asString(record.path) ??
    asString(record.localPath) ??
    asString(record.local_path);
  if (!originalUrl?.startsWith("http") || !localPath) {
    return null;
  }

  const rawRole = asString(record.role);
  const role =
    rawRole === "cover" || rawRole === "content" ? rawRole : fallbackRole;
  return {
    kind: "image" as const,
    path: localPath,
    originalUrl,
    fileName: asString(record.fileName) ?? asString(record.file_name),
    mimeType: asString(record.mimeType) ?? asString(record.mime_type),
    role,
  };
}

function normalizeHtmlContent(htmlContent: string | null): string | null {
  if (!htmlContent) {
    return null;
  }
  if (/<(?:html|article)(?:\s|>)/i.test(htmlContent)) {
    return htmlContent;
  }
  return `<article>${htmlContent}</article>`;
}

export class WechatArticleProvider implements LinkResolverProvider {
  id = "wechat-article";
  fallbackPolicy = "fail_fast" as const;

  constructor(private readonly options: WechatArticleProviderOptions) {}

  canResolve(url: URL): boolean {
    return (
      url.hostname === "mp.weixin.qq.com" ||
      url.hostname.endsWith(".mp.weixin.qq.com")
    );
  }

  async resolve(input: LinkResolverInput): Promise<LinkResolverResult> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (this.options.authKey) {
      headers["x-auth-key"] = this.options.authKey;
    }

    const response = await fetch(this.options.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: input.url }),
      signal: input.abortSignal,
    });

    if (!response.ok) {
      return {
        status: "failure",
        retryable: response.status >= 500,
        reason: `WeChat article resolver returned HTTP ${response.status}`,
      };
    }

    const payload = asRecord(await response.json());
    if (!payload) {
      return {
        status: "failure",
        retryable: false,
        reason: "WeChat article resolver response is not an object",
      };
    }

    if (payload.success !== true) {
      const reason = asString(payload.reason) ?? "UNKNOWN";
      const message = asString(payload.message) ?? "unknown error";
      return {
        status: "failure",
        retryable: asBoolean(payload.retryable) ?? false,
        reason: `WeChat article resolver failed: ${reason}: ${message}`,
      };
    }

    const htmlContent = normalizeHtmlContent(
      asString(payload.contentHtml) ?? asString(payload.contentMarkdown),
    );
    const imageUrls = extractImageUrls(payload);
    const downloadedAssets = extractDownloadedImageAssets(payload);

    return {
      status: "success",
      content: {
        title: asString(payload.title),
        description:
          asString(payload.summary) ??
          asString(payload.contentText) ??
          asString(payload.contentMarkdown),
        author: asString(payload.author),
        publisher: asString(payload.accountName),
        imageUrl: imageUrls[0] ?? null,
        htmlContent,
        archivableAssets:
          downloadedAssets.length > 0
            ? downloadedAssets
            : imageUrls.map((url, index) => ({
                kind: "image" as const,
                url,
                originalUrl: url,
                role: index === 0 ? ("cover" as const) : ("content" as const),
              })),
        finalUrl: asString(payload.finalUrl) ?? input.url,
        datePublished: asDate(payload.publishedAt),
      },
    };
  }
}
