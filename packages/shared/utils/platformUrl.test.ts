import { describe, expect, test } from "vitest";

import { getPlatformAppUrlCandidate } from "./platformUrl";

describe("getPlatformAppUrlCandidate", () => {
  test("builds a Xiaohongshu app url from an explore URL", () => {
    expect(
      getPlatformAppUrlCandidate("https://www.xiaohongshu.com/explore/abc123"),
    ).toEqual({
      platform: "xiaohongshu",
      appUrl: "xhsdiscover://item/abc123",
    });
  });

  test("builds a Douyin app url from a video URL", () => {
    expect(
      getPlatformAppUrlCandidate("https://www.douyin.com/video/73123456789"),
    ).toEqual({
      platform: "douyin",
      appUrl: "snssdk1128://aweme/detail/73123456789",
    });
  });

  test("builds a Coolapk app url from a feed URL", () => {
    expect(
      getPlatformAppUrlCandidate("https://www.coolapk.com/feed/123456"),
    ).toEqual({
      platform: "coolapk",
      appUrl: "coolmarket://feed/123456",
    });
  });

  test("returns null for unsupported URLs", () => {
    expect(getPlatformAppUrlCandidate("https://example.com/post/1")).toBeNull();
  });
});
