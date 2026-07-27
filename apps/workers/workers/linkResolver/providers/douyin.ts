import type {
  LinkResolverInput,
  LinkResolverProvider,
  LinkResolverResult,
  ResolvedLinkAsset,
} from "../types";

export interface DouyinProviderOptions {
  endpoint: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function joinEndpoint(endpoint: string, path: string) {
  return `${endpoint.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function parseFailurePayload(
  payload: UnknownRecord | null,
  fallbackReason: string,
): LinkResolverResult {
  const reason = asString(payload?.reason) ?? fallbackReason;
  const message = asString(payload?.message) ?? asString(payload?.error);
  return {
    status: "failure",
    retryable: asBoolean(payload?.retryable) ?? false,
    reason: `Douyin resolver failed: ${reason}${message ? `: ${message}` : ""}`,
  };
}

async function readJson(response: Response): Promise<UnknownRecord | null> {
  try {
    return asRecord(await response.json());
  } catch {
    return null;
  }
}

async function sleep(ms: number, abortSignal: AbortSignal) {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    abortSignal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(abortSignal.reason);
      },
      { once: true },
    );
  });
}

function extractFiles(item: UnknownRecord): ResolvedLinkAsset[] {
  const files = item.files;
  if (!Array.isArray(files)) {
    return [];
  }

  return files.flatMap((file): ResolvedLinkAsset[] => {
    const record = asRecord(file);
    if (!record) {
      return [];
    }

    const type = asString(record.type);
    const filePath = asString(record.path);
    if (!filePath) {
      return [];
    }

    const fileName = asString(record.name) ?? asString(record.fileName);
    const mimeType = asString(record.mimeType) ?? asString(record.mime_type);

    if (type === "cover" || type === "image") {
      return [
        {
          kind: "image" as const,
          path: filePath,
          originalUrl: filePath,
          fileName,
          mimeType,
          role: type === "cover" ? ("cover" as const) : ("content" as const),
        },
      ];
    }

    if (type === "video") {
      return [
        {
          kind: "video" as const,
          path: filePath,
          originalUrl: filePath,
          fileName,
          mimeType,
          role: "content" as const,
        },
      ];
    }

    if (type === "metadata" || type === "comments") {
      return [
        {
          kind: "file" as const,
          path: filePath,
          fileName,
          mimeType: mimeType ?? "application/json",
          role: "metadata" as const,
        },
      ];
    }

    return [];
  });
}

function selectFirstItem(payload: UnknownRecord): UnknownRecord | null {
  const result = asRecord(payload.result);
  const items = result?.items;
  if (!Array.isArray(items)) {
    return null;
  }
  return asRecord(items[0]);
}

function buildHtml(args: {
  title: string | null;
  author: string | null;
  cover: ResolvedLinkAsset | null;
  video: ResolvedLinkAsset | null;
}) {
  const html: string[] = ['<article class="douyin-archive">'];
  html.push(
    "<style>.douyin-archive{max-width:760px;margin:0 auto}.douyin-video{margin:0 0 24px}.douyin-video video{display:block;width:100%;max-height:80vh;border-radius:12px;background:#000}.douyin-meta{color:#666;font-size:14px}</style>",
  );
  if (args.title) {
    html.push(`<h1>${escapeHtml(args.title)}</h1>`);
  }
  if (args.author) {
    html.push(`<p class="douyin-meta">${escapeHtml(args.author)}</p>`);
  }
  if (args.video?.path) {
    const poster = args.cover?.path
      ? ` poster="${escapeHtmlAttribute(args.cover.path)}"`
      : "";
    html.push(
      `<figure class="douyin-video"><video src="${escapeHtmlAttribute(args.video.path)}"${poster} controls preload="metadata" playsinline></video></figure>`,
    );
  } else if (args.cover?.path) {
    html.push(
      `<figure><img src="${escapeHtmlAttribute(args.cover.path)}" alt="${escapeHtmlAttribute(args.title ?? "Douyin cover")}"></figure>`,
    );
  }
  html.push("</article>");
  return html.join("");
}

export class DouyinProvider implements LinkResolverProvider {
  id = "douyin";
  fallbackPolicy = "fail_fast" as const;

  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: DouyinProviderOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.timeoutMs = options.timeoutMs ?? 120000;
  }

  canResolve(url: URL): boolean {
    return (
      url.hostname === "douyin.com" ||
      url.hostname.endsWith(".douyin.com") ||
      url.hostname === "iesdouyin.com" ||
      url.hostname.endsWith(".iesdouyin.com")
    );
  }

  async resolve(input: LinkResolverInput): Promise<LinkResolverResult> {
    const createResponse = await fetch(
      joinEndpoint(this.options.endpoint, "download"),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: input.url }),
        signal: input.abortSignal,
      },
    );
    const createPayload = await readJson(createResponse);

    if (!createResponse.ok || createPayload?.success === false) {
      return parseFailurePayload(
        createPayload,
        `HTTP ${createResponse.status}`,
      );
    }

    const jobId = asString(createPayload?.jobId);
    if (!jobId) {
      return {
        status: "failure",
        retryable: false,
        reason: "Douyin resolver did not return a jobId",
      };
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt <= this.timeoutMs) {
      input.abortSignal.throwIfAborted();
      const jobResponse = await fetch(
        joinEndpoint(
          this.options.endpoint,
          `jobs/${encodeURIComponent(jobId)}`,
        ),
        {
          headers: { accept: "application/json" },
          signal: input.abortSignal,
        },
      );
      const jobPayload = await readJson(jobResponse);
      if (!jobResponse.ok || jobPayload?.success === false) {
        return parseFailurePayload(jobPayload, `HTTP ${jobResponse.status}`);
      }

      const status = asString(jobPayload?.status);
      if (status === "success") {
        const item = jobPayload ? selectFirstItem(jobPayload) : null;
        if (!item) {
          return {
            status: "failure",
            retryable: false,
            reason: "Douyin resolver completed without any item",
          };
        }

        const assets = extractFiles(item);
        const cover =
          assets.find(
            (asset) => asset.kind === "image" && asset.role === "cover",
          ) ?? null;
        const video =
          assets.find(
            (asset) => asset.kind === "video" && asset.role === "content",
          ) ?? null;
        const title = asString(item.title);
        const author = asString(item.author);

        return {
          status: "success",
          content: {
            title,
            description: title,
            author,
            publisher: "抖音",
            imageUrl: cover?.path ?? null,
            htmlContent: buildHtml({ title, author, cover, video }),
            finalUrl: input.url,
            datePublished: asDate(item.publishedAt),
            archivableAssets: assets,
            skipVideoDownload: true,
          },
        };
      }

      if (status === "failed" || status === "failure") {
        return parseFailurePayload(jobPayload, "JOB_FAILED");
      }

      await sleep(this.pollIntervalMs, input.abortSignal);
    }

    return {
      status: "failure",
      retryable: true,
      reason: "Douyin resolver timed out",
    };
  }
}
