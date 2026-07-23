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

    const htmlContent =
      asString(payload.contentMarkdown) ?? asString(payload.contentHtml);
    const imageUrls = extractImageUrls(payload);

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
        archivableAssets: imageUrls.map((url, index) => ({
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
