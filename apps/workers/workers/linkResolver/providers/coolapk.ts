import type {
  LinkResolverInput,
  LinkResolverProvider,
  LinkResolverResult,
} from "../types";

export interface CoolapkProviderOptions {
  endpoint: string;
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

function asTimestampDate(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return new Date(value * 1000);
}

function extractImages(feed: UnknownRecord): string[] {
  const images = feed.images;
  if (!Array.isArray(images)) {
    return [];
  }
  return images.filter(
    (image): image is string =>
      typeof image === "string" && image.startsWith("http"),
  );
}

function extractBlockImageUrls(feed: UnknownRecord): string[] {
  const blocks = feed.blocks;
  if (!Array.isArray(blocks)) {
    return [];
  }
  return blocks
    .map((block) => asString(asRecord(block)?.url))
    .filter((url): url is string => !!url?.startsWith("http"));
}

function buildMarkdownFromBlocks(
  title: string | null,
  blocks: unknown,
): string | null {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return null;
  }

  const markdownBlocks: string[] = [];
  if (title) {
    markdownBlocks.push(`# ${title}`);
  }

  for (const block of blocks) {
    const record = asRecord(block);
    if (!record) {
      continue;
    }
    if (record.type === "text") {
      const text = asString(record.text);
      if (text) {
        markdownBlocks.push(text);
      }
    } else if (record.type === "image") {
      const url = asString(record.url);
      if (url) {
        const description = asString(record.description) ?? "image";
        markdownBlocks.push(`![${description}](${url})`);
      }
    }
  }

  return markdownBlocks.join("\n\n") || null;
}

function buildFallbackMarkdown(
  title: string | null,
  message: string | null,
  images: string[],
): string | null {
  const blocks: string[] = [];
  if (title) {
    blocks.push(`# ${title}`);
  }
  if (message) {
    blocks.push(message);
  }
  images.forEach((image, index) => {
    blocks.push(`![image ${index + 1}](${image})`);
  });
  return blocks.join("\n\n") || null;
}

export class CoolapkProvider implements LinkResolverProvider {
  id = "coolapk";
  fallbackPolicy = "fail_fast" as const;

  constructor(private readonly options: CoolapkProviderOptions) {}

  canResolve(url: URL): boolean {
    return (
      url.hostname === "coolapk.com" ||
      url.hostname.endsWith(".coolapk.com") ||
      url.hostname === "coolmarket.com.cn" ||
      url.hostname.endsWith(".coolmarket.com.cn")
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
        reason: `Coolapk resolver returned HTTP ${response.status}`,
      };
    }

    const payload = asRecord(await response.json());
    if (!payload) {
      return {
        status: "failure",
        retryable: false,
        reason: "Coolapk resolver response is not an object",
      };
    }

    if (payload.success !== true) {
      return {
        status: "failure",
        retryable: false,
        reason: `Coolapk resolver failed: ${asString(payload.msg) ?? "unknown error"}`,
      };
    }

    const feed = asRecord(payload.feed);
    if (!feed) {
      return {
        status: "failure",
        retryable: false,
        reason: "Coolapk resolver response did not contain feed",
      };
    }

    const title = asString(feed.title);
    const message = asString(feed.message);
    const author = asString(asRecord(feed.author)?.username);
    const blockImageUrls = extractBlockImageUrls(feed);
    const fallbackImages = extractImages(feed);
    const htmlContent =
      buildMarkdownFromBlocks(title, feed.blocks) ??
      buildFallbackMarkdown(title, message, fallbackImages);

    return {
      status: "success",
      content: {
        title,
        description: message,
        author,
        imageUrl: blockImageUrls[0] ?? fallbackImages[0] ?? null,
        htmlContent,
        finalUrl: asString(feed.share_url) ?? input.url,
        datePublished: asTimestampDate(feed.created_at),
      },
    };
  }
}
