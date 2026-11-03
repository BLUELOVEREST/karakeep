export type CrawlErrorSource =
  | "generic_crawler"
  | "link_resolver"
  | "asset_download"
  | "reader_image_archive"
  | "unknown";

export type CrawlErrorCode =
  | "HTTP_FORBIDDEN"
  | "RATE_LIMITED"
  | "UPSTREAM_5XX"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "ASSET_DOWNLOAD_FAILED"
  | "READER_IMAGE_ARCHIVE_FAILED"
  | "PARSE_FAILED"
  | "RESOLVER_UNCONFIGURED"
  | "RESOLVER_HTTP_ERROR"
  | "RESOLVER_UNAVAILABLE"
  | "AUTH_REQUIRED"
  | "COOKIE_EXPIRED"
  | "DOWNLOAD_FAILED"
  | "INVALID_RESPONSE"
  | "UNSUPPORTED_URL"
  | "UNKNOWN";

export interface StructuredCrawlError {
  source: CrawlErrorSource;
  code: CrawlErrorCode;
  message: string;
  retryable: boolean;
}

export class CrawlError extends Error {
  readonly crawlError: StructuredCrawlError;

  constructor(crawlError: StructuredCrawlError) {
    super(crawlError.message);
    this.name = "CrawlError";
    this.crawlError = crawlError;
  }
}

export function crawlErrorFromStatusCode(
  statusCode: number | null,
  message?: string,
): StructuredCrawlError | null {
  if (statusCode === null) {
    return null;
  }

  if (statusCode === 403) {
    return {
      source: "generic_crawler",
      code: "HTTP_FORBIDDEN",
      message: message ?? "Crawler received HTTP 403",
      retryable: true,
    };
  }

  if (statusCode === 429) {
    return {
      source: "generic_crawler",
      code: "RATE_LIMITED",
      message: message ?? "Crawler was rate limited",
      retryable: true,
    };
  }

  if (statusCode >= 500) {
    return {
      source: "generic_crawler",
      code: "UPSTREAM_5XX",
      message: message ?? `Crawler received HTTP ${statusCode}`,
      retryable: true,
    };
  }

  return null;
}

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function classifyMessage(
  message: string,
  fallbackCode: CrawlErrorCode,
): Pick<StructuredCrawlError, "code" | "retryable"> {
  const normalized = message.toLowerCase();

  if (/\b403\b/.test(message) || normalized.includes("forbidden")) {
    return { code: "HTTP_FORBIDDEN", retryable: true };
  }
  if (/\b429\b/.test(message) || normalized.includes("rate limit")) {
    return { code: "RATE_LIMITED", retryable: true };
  }
  if (/\b5\d\d\b/.test(message)) {
    return { code: "UPSTREAM_5XX", retryable: true };
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return { code: "TIMEOUT", retryable: true };
  }
  if (
    normalized.includes("network") ||
    normalized.includes("econnreset") ||
    normalized.includes("enotfound") ||
    normalized.includes("fetch failed")
  ) {
    return { code: "NETWORK_ERROR", retryable: true };
  }
  if (
    normalized.includes("unsupported") &&
    normalized.includes("content type")
  ) {
    return { code: "UNSUPPORTED_CONTENT_TYPE", retryable: false };
  }
  if (normalized.includes("cookie") && normalized.includes("expired")) {
    return { code: "COOKIE_EXPIRED", retryable: false };
  }
  if (
    normalized.includes("auth") ||
    normalized.includes("login") ||
    normalized.includes("unauthorized")
  ) {
    return { code: "AUTH_REQUIRED", retryable: false };
  }
  if (normalized.includes("invalid") && normalized.includes("response")) {
    return { code: "INVALID_RESPONSE", retryable: false };
  }
  if (normalized.includes("download")) {
    return { code: "DOWNLOAD_FAILED", retryable: true };
  }
  if (normalized.includes("parse")) {
    return { code: "PARSE_FAILED", retryable: false };
  }

  return { code: fallbackCode, retryable: false };
}

export function classifyCrawlError(
  error: unknown,
  options: {
    source?: CrawlErrorSource;
    fallbackCode?: CrawlErrorCode;
    retryable?: boolean;
  } = {},
): StructuredCrawlError {
  if (error instanceof CrawlError) {
    return error.crawlError;
  }

  const message = messageFromUnknown(error);
  const classified = classifyMessage(
    message,
    options.fallbackCode ?? "UNKNOWN",
  );

  return {
    source: options.source ?? "unknown",
    code: classified.code,
    message,
    retryable: options.retryable ?? classified.retryable,
  };
}

export function linkResolverCrawlError(
  providerId: string,
  error: { reason: string; retryable: boolean },
): StructuredCrawlError {
  const message = `[${providerId}] ${error.reason}`;
  const classified = classifyMessage(error.reason, "UNKNOWN");
  let code = classified.code;

  if (error.reason.includes("resolver is not configured")) {
    code = "RESOLVER_UNCONFIGURED";
  } else if (/returned HTTP 5\d\d/.test(error.reason)) {
    code = "RESOLVER_UNAVAILABLE";
  } else if (/returned HTTP \d+/.test(error.reason)) {
    code = "RESOLVER_HTTP_ERROR";
  } else if (error.reason.includes("response is not an object")) {
    code = "INVALID_RESPONSE";
  } else if (error.reason.includes("unsupported")) {
    code = "UNSUPPORTED_URL";
  }

  return {
    source: "link_resolver",
    code,
    message,
    retryable: error.retryable,
  };
}
