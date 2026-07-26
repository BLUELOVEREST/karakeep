import type {
  LinkResolverInput,
  LinkResolverProvider,
  LinkResolverResult,
} from "../types";

export interface XiaohongshuMcpProviderOptions {
  endpoint: string;
}

interface XiaohongshuNoteLocator {
  feedId: string;
  xsecToken: string;
}

type UnknownRecord = Record<string, unknown>;

export function parseXiaohongshuNoteLocator(
  rawUrl: string,
): XiaohongshuNoteLocator | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const match = url.pathname.match(/\/(?:explore|discovery\/item)\/([^/?#]+)/);
  const feedId = match?.[1];
  const xsecToken = url.searchParams.get("xsec_token");
  if (!feedId || !xsecToken) {
    return null;
  }
  return { feedId, xsecToken };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function extractTextContent(response: unknown): string | null {
  const root = asRecord(response);
  const result = asRecord(root?.result);
  const content = result?.content;
  if (!Array.isArray(content)) {
    return null;
  }

  for (const item of content) {
    const record = asRecord(item);
    const text = asString(record?.text);
    if (text) {
      return text;
    }
  }
  return null;
}

function parseNoteDetail(text: string): UnknownRecord | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function extractFirstImageUrl(note: UnknownRecord): string | null {
  const imageList = note.image_list ?? note.images;
  if (!Array.isArray(imageList)) {
    return null;
  }
  for (const image of imageList) {
    const record = asRecord(image);
    const url =
      asString(record?.url) ??
      asString(record?.traceId) ??
      asString(record?.url_default);
    if (url?.startsWith("http://") || url?.startsWith("https://")) {
      return url;
    }
  }
  return null;
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

export class XiaohongshuMcpProvider implements LinkResolverProvider {
  id = "xiaohongshu-mcp";
  fallbackPolicy = "fail_fast" as const;

  constructor(private readonly options: XiaohongshuMcpProviderOptions) {}

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
    const locator = parseXiaohongshuNoteLocator(input.url);
    if (!locator) {
      return {
        status: "failure",
        retryable: false,
        reason: "Xiaohongshu URL does not contain feed_id and xsec_token",
      };
    }

    const response = await fetch(this.options.endpoint, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${input.jobId}:xiaohongshu:get_feed_detail`,
        method: "tools/call",
        params: {
          name: "get_feed_detail",
          arguments: {
            feed_id: locator.feedId,
            xsec_token: locator.xsecToken,
          },
        },
      }),
      signal: input.abortSignal,
    });

    if (!response.ok) {
      return {
        status: "failure",
        retryable: response.status >= 500,
        reason: `xiaohongshu-mcp returned HTTP ${response.status}`,
      };
    }

    const payload: unknown = await response.json();
    const textContent = extractTextContent(payload);
    if (!textContent) {
      return {
        status: "failure",
        retryable: false,
        reason: "xiaohongshu-mcp response did not contain text content",
      };
    }

    const note = parseNoteDetail(textContent);
    if (!note) {
      return {
        status: "failure",
        retryable: false,
        reason: "xiaohongshu-mcp note content is not valid JSON",
      };
    }

    const title = asString(note.title);
    const description = asString(note.desc) ?? asString(note.description);
    const author = asString(asRecord(note.user)?.nickname);
    const imageUrls = extractImageUrls(note);

    return {
      status: "success",
      content: {
        title,
        description,
        author,
        imageUrl: extractFirstImageUrl(note),
        htmlContent: buildMarkdown(title, description, imageUrls),
        archivableAssets: imageUrls.map((url, index) => ({
          kind: "image" as const,
          url,
          originalUrl: url,
          role: index === 0 ? ("cover" as const) : ("content" as const),
        })),
        finalUrl: input.url,
      },
    };
  }
}
