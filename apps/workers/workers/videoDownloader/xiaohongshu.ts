export interface XiaohongshuDownloadedFile {
  path: string;
  name?: string | null;
  mimeType?: string | null;
}

export type XiaohongshuMediaDownloadResult =
  | {
      status: "success";
      coverFile?: XiaohongshuDownloadedFile;
      videoFile?: XiaohongshuDownloadedFile;
      title?: string | null;
    }
  | {
      status: "failure";
      retryable: boolean;
      reason: string;
    };

export interface ResolveXiaohongshuMediaDownloadOptions {
  endpoint: string;
  url: string;
  abortSignal: AbortSignal;
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

function fileFromRecord(
  record: UnknownRecord,
): XiaohongshuDownloadedFile | null {
  const filePath = asString(record.path);
  if (!filePath) {
    return null;
  }
  return {
    path: filePath,
    name: asString(record.name),
    mimeType: asString(record.mimeType),
  };
}

export function isXiaohongshuUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  return (
    url.hostname === "xiaohongshu.com" ||
    url.hostname.endsWith(".xiaohongshu.com") ||
    url.hostname === "xhslink.com" ||
    url.hostname.endsWith(".xhslink.com")
  );
}

export function selectXiaohongshuDownloadedFiles(result: unknown): {
  coverFile?: XiaohongshuDownloadedFile;
  videoFile?: XiaohongshuDownloadedFile;
  title?: string | null;
} | null {
  const record = asRecord(result);
  const files = record?.files;
  if (!Array.isArray(files)) {
    return null;
  }

  let coverFile: XiaohongshuDownloadedFile | undefined;
  let videoFile: XiaohongshuDownloadedFile | undefined;
  for (const file of files) {
    const fileRecord = asRecord(file);
    if (!fileRecord) {
      continue;
    }
    if (
      !coverFile &&
      fileRecord.kind === "image" &&
      fileRecord.role === "cover"
    ) {
      coverFile = fileFromRecord(fileRecord) ?? undefined;
    }
    if (!videoFile && fileRecord.kind === "video") {
      videoFile = fileFromRecord(fileRecord) ?? undefined;
    }
  }

  if (!coverFile && !videoFile) {
    return null;
  }

  return {
    coverFile,
    videoFile,
    title: asString(asRecord(record?.note)?.title),
  };
}

export async function resolveXiaohongshuMediaDownload({
  endpoint,
  url,
  abortSignal,
}: ResolveXiaohongshuMediaDownloadOptions): Promise<XiaohongshuMediaDownloadResult> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ url, mediaTypes: ["image", "video"] }),
    signal: abortSignal,
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
      reason: `Spider_XHS download failed: ${errorCode}: ${msg}`,
    };
  }

  const selected = selectXiaohongshuDownloadedFiles(payload);
  if (!selected) {
    return {
      status: "failure",
      retryable: false,
      reason: "Spider_XHS download completed without downloadable media files",
    };
  }

  return {
    status: "success",
    ...selected,
  };
}
