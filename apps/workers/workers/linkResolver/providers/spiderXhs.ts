import type {
  LinkResolverInput,
  LinkResolverProvider,
  LinkResolverResult,
} from "../types";

export interface SpiderXhsProviderOptions {
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

function extractImageUrls(note: UnknownRecord): string[] {
  const imageList = note.image_list ?? note.images;
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
    .filter((url): url is string => !!url?.startsWith("http"));
}

function buildMarkdown(
  title: string | null,
  description: string | null,
  imageUrls: string[],
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
  return blocks.join("\n\n") || null;
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
      url.hostname.endsWith(".xhslink.com")
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
    const imageUrls = extractImageUrls(note);

    return {
      status: "success",
      content: {
        title,
        description,
        author,
        imageUrl: imageUrls[0] ?? null,
        htmlContent: buildMarkdown(title, description, imageUrls),
        finalUrl: input.url,
      },
    };
  }
}
