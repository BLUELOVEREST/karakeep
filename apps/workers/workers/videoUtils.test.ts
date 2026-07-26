import { describe, expect, it } from "vitest";

import {
  getVideoContentTypeForDownloadedFile,
  shouldSkipFullPageArchiveForVideoUrl,
} from "./videoUtils";

describe("video utils", () => {
  it("skips full page archive for video platform URLs", () => {
    expect(
      shouldSkipFullPageArchiveForVideoUrl(
        "https://www.youtube.com/watch?v=yPeEQitu_-o",
      ),
    ).toBe(true);
    expect(
      shouldSkipFullPageArchiveForVideoUrl("https://youtu.be/yPeEQitu_-o"),
    ).toBe(true);
    expect(
      shouldSkipFullPageArchiveForVideoUrl(
        "https://m.youtube.com/watch?v=yPeEQitu_-o",
      ),
    ).toBe(true);
    expect(
      shouldSkipFullPageArchiveForVideoUrl(
        "https://www.bilibili.com/video/BV1FZEM63Eh4/",
      ),
    ).toBe(true);
    expect(
      shouldSkipFullPageArchiveForVideoUrl(
        "https://m.bilibili.com/video/BV1FZEM63Eh4/",
      ),
    ).toBe(true);
    expect(
      shouldSkipFullPageArchiveForVideoUrl("https://b23.tv/BV1FZEM63Eh4"),
    ).toBe(true);
    expect(
      shouldSkipFullPageArchiveForVideoUrl("https://example.com/watch?v=1"),
    ).toBe(false);
    expect(shouldSkipFullPageArchiveForVideoUrl("not a url")).toBe(false);
  });

  it("infers video content type from downloaded file extension when resolver did not provide one", () => {
    expect(
      getVideoContentTypeForDownloadedFile(null, "/tmp/video/asset.webm"),
    ).toBe("video/webm");
    expect(
      getVideoContentTypeForDownloadedFile(undefined, "/tmp/video/asset.mkv"),
    ).toBe("video/x-matroska");
    expect(
      getVideoContentTypeForDownloadedFile("", "/tmp/video/asset.mp4"),
    ).toBe("video/mp4");
  });

  it("keeps explicit resolver video content type before checking file extension", () => {
    expect(
      getVideoContentTypeForDownloadedFile(
        "video/mp4",
        "/tmp/video/asset.webm",
      ),
    ).toBe("video/mp4");
  });
});
