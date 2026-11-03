import { describe, expect, it } from "vitest";

import {
  classifyCrawlError,
  crawlErrorFromStatusCode,
  linkResolverCrawlError,
} from "./crawlError";

describe("crawl error classification", () => {
  it("classifies retryable default crawler HTTP statuses", () => {
    expect(crawlErrorFromStatusCode(403)).toMatchObject({
      source: "generic_crawler",
      code: "HTTP_FORBIDDEN",
      retryable: true,
    });
    expect(crawlErrorFromStatusCode(429)).toMatchObject({
      source: "generic_crawler",
      code: "RATE_LIMITED",
      retryable: true,
    });
    expect(crawlErrorFromStatusCode(503)).toMatchObject({
      source: "generic_crawler",
      code: "UPSTREAM_5XX",
      retryable: true,
    });
    expect(crawlErrorFromStatusCode(404)).toBeNull();
  });

  it("normalizes resolver auth and cookie failures", () => {
    expect(
      linkResolverCrawlError("spider-xhs", {
        reason: "Spider_XHS failed: cookie expired",
        retryable: false,
      }),
    ).toMatchObject({
      source: "link_resolver",
      code: "COOKIE_EXPIRED",
      retryable: false,
    });

    expect(
      linkResolverCrawlError("wechat-article", {
        reason: "WeChat article resolver failed: AUTH_REQUIRED: login required",
        retryable: false,
      }),
    ).toMatchObject({
      source: "link_resolver",
      code: "AUTH_REQUIRED",
      retryable: false,
    });
  });

  it("classifies generic thrown errors without losing the message", () => {
    expect(
      classifyCrawlError(new Error("Failed to download reader image: 403"), {
        source: "reader_image_archive",
      }),
    ).toMatchObject({
      source: "reader_image_archive",
      code: "HTTP_FORBIDDEN",
      retryable: true,
      message: "Failed to download reader image: 403",
    });

    expect(
      classifyCrawlError(
        new Error("Unsupported image content type: text/html"),
      ),
    ).toMatchObject({
      source: "unknown",
      code: "UNSUPPORTED_CONTENT_TYPE",
      retryable: false,
    });
  });
});
