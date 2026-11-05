import { z } from "zod";

import type { ZCrawlErrorCode } from "./captureErrorMessages";

export const zCaptureEventType = z.enum([
  "capture.failed",
  "capture.partial",
  "capture.recovered",
  "push.test",
]);
export const zEventCursor = z.object({
  cursor: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(50),
});
export const zPushRegistration = z.object({
  token: z
    .string()
    .min(16)
    .max(4096)
    .regex(/^[A-Za-z0-9_:.-]+$/),
  scope: z.string().min(1).max(200),
});
export const zCaptureEvent = z.object({
  title: z.string().nullable(),
  id: z.number(),
  bookmarkId: z.string().nullable(),
  type: zCaptureEventType,
  platform: z.string(),
  code: z.string().nullable(),
  message: z.string(),
  retryable: z.boolean(),
  createdAt: z.date(),
});
export type CaptureEventType = z.infer<typeof zCaptureEventType>;

export function captureAdvice(code: ZCrawlErrorCode | string | null) {
  if (code === "STORAGE_QUOTA_EXCEEDED")
    return "Free some storage or increase your quota, then retry.";
  switch (code) {
    case "COOKIE_EXPIRED":
      return "Update the platform Cookie, then retry capture.";
    case "AUTH_REQUIRED":
      return "Check the platform login or resolver service key, then retry capture.";
    case "RESOLVER_UNCONFIGURED":
      return "Configure the resolver endpoint before retrying.";
    case "RATE_LIMITED":
      return "Wait before retrying; the website has limited requests.";
    case "HTTP_FORBIDDEN":
      return "The website refused access; check access restrictions before retrying.";
    case "TIMEOUT":
      return "The request timed out. Check connectivity and try again.";
    case "NETWORK_ERROR":
    case "UPSTREAM_5XX":
    case "RESOLVER_UNAVAILABLE":
      return "Check network and service availability, then retry.";
    case "READER_IMAGE_ARCHIVE_FAILED":
    case "ASSET_DOWNLOAD_FAILED":
    case "DOWNLOAD_FAILED":
      return "Some resources could not be saved. Retry after checking the source and network.";
    default:
      return "Check the capture error and retry. The cause could not be confirmed.";
  }
}
