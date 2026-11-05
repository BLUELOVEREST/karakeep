import type { ZCrawlError } from "./bookmarks";

export type ZCrawlErrorCode = ZCrawlError["code"];

export const captureErrorMessage = (code: string) =>
  (
    ({
      COOKIE_EXPIRED: "The platform reported an expired Cookie.",
      AUTH_REQUIRED:
        "Authentication is required or the supplied credentials were rejected.",
      RATE_LIMITED: "The website is limiting requests.",
      HTTP_FORBIDDEN: "The website refused access.",
      UPSTREAM_5XX: "The source website returned a server error.",
      TIMEOUT: "Capture timed out.",
      NETWORK_ERROR: "A network request failed.",
      RESOLVER_UNCONFIGURED: "The platform resolver is not configured.",
      RESOLVER_UNAVAILABLE: "The platform resolver is unavailable.",
      RESOLVER_HTTP_ERROR: "The resolver returned an unsuccessful response.",
      INVALID_RESPONSE: "The resolver response could not be processed.",
      READER_IMAGE_ARCHIVE_FAILED: "Some reader images could not be archived.",
      ASSET_DOWNLOAD_FAILED: "An attachment could not be downloaded.",
      DOWNLOAD_FAILED: "Media could not be downloaded.",
      STORAGE_QUOTA_EXCEEDED: "Storage quota exceeded.",
      UNSUPPORTED_URL: "The link is not supported by this resolver.",
      UNSUPPORTED_CONTENT_TYPE: "The returned content type is not supported.",
      PARSE_FAILED: "The page could not be parsed.",
    }) as Record<string, string>
  )[code] ?? "Capture failed for an unconfirmed reason.";
