export interface DouyinVideoFile {
  path: string;
  name?: string | null;
  mimeType?: string | null;
}

export type DouyinVideoDownloadResult =
  | {
      status: "success";
      file: DouyinVideoFile;
      title?: string | null;
    }
  | {
      status: "failure";
      retryable: boolean;
      reason: string;
    };

export interface ResolveDouyinVideoDownloadOptions {
  endpoint: string;
  url: string;
  abortSignal: AbortSignal;
  pollIntervalMs: number;
  timeoutMs: number;
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

function joinEndpoint(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, "")}${path}`;
}

function failureFromPayload(payload: UnknownRecord): DouyinVideoDownloadResult {
  const reason = asString(payload.reason) ?? "UNKNOWN";
  const message = asString(payload.message) ?? "unknown error";
  return {
    status: "failure",
    retryable: asBoolean(payload.retryable) ?? false,
    reason: `Douyin resolver failed: ${reason}: ${message}`,
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export function isDouyinUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  return (
    url.hostname === "douyin.com" ||
    url.hostname.endsWith(".douyin.com") ||
    url.hostname === "iesdouyin.com" ||
    url.hostname.endsWith(".iesdouyin.com")
  );
}

export function selectDouyinVideoFile(
  result: unknown,
): { file: DouyinVideoFile; title?: string | null } | null {
  const record = asRecord(result);
  const items = record?.items;
  if (!Array.isArray(items)) {
    return null;
  }

  for (const item of items) {
    const itemRecord = asRecord(item);
    if (!itemRecord) {
      continue;
    }
    const files = itemRecord.files;
    if (!Array.isArray(files)) {
      continue;
    }
    for (const file of files) {
      const fileRecord = asRecord(file);
      if (!fileRecord || fileRecord.type !== "video") {
        continue;
      }
      const filePath = asString(fileRecord.path);
      if (!filePath) {
        continue;
      }
      return {
        file: {
          path: filePath,
          name: asString(fileRecord.name),
          mimeType: asString(fileRecord.mimeType),
        },
        title: asString(itemRecord.title),
      };
    }
  }

  return null;
}

export async function resolveDouyinVideoDownload({
  endpoint,
  url,
  abortSignal,
  pollIntervalMs,
  timeoutMs,
}: ResolveDouyinVideoDownloadOptions): Promise<DouyinVideoDownloadResult> {
  const createResponse = await fetch(joinEndpoint(endpoint, "/download"), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ url }),
    signal: abortSignal,
  });

  if (!createResponse.ok) {
    return {
      status: "failure",
      retryable: createResponse.status >= 500,
      reason: `Douyin resolver returned HTTP ${createResponse.status}`,
    };
  }

  const createPayload = asRecord(await createResponse.json());
  if (!createPayload) {
    return {
      status: "failure",
      retryable: false,
      reason: "Douyin resolver create response is not an object",
    };
  }
  if (createPayload.success === false) {
    return failureFromPayload(createPayload);
  }

  const jobId = asString(createPayload.jobId);
  if (!jobId) {
    return {
      status: "failure",
      retryable: false,
      reason: "Douyin resolver create response did not include jobId",
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const jobResponse = await fetch(joinEndpoint(endpoint, `/jobs/${jobId}`), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: abortSignal,
    });

    if (!jobResponse.ok) {
      return {
        status: "failure",
        retryable: jobResponse.status >= 500,
        reason: `Douyin resolver job response returned HTTP ${jobResponse.status}`,
      };
    }

    const jobPayload = asRecord(await jobResponse.json());
    if (!jobPayload) {
      return {
        status: "failure",
        retryable: false,
        reason: "Douyin resolver job response is not an object",
      };
    }
    if (jobPayload.success === false) {
      return failureFromPayload(jobPayload);
    }
    if (jobPayload.status === "success") {
      const selected = selectDouyinVideoFile(jobPayload.result);
      if (!selected) {
        return {
          status: "failure",
          retryable: false,
          reason: "Douyin resolver completed without a downloadable video file",
        };
      }
      return {
        status: "success",
        file: selected.file,
        title: selected.title,
      };
    }

    await sleep(pollIntervalMs, abortSignal);
  }

  return {
    status: "failure",
    retryable: true,
    reason: "Douyin resolver timed out while waiting for job completion",
  };
}
