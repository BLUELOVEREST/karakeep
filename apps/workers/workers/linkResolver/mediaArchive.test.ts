import { describe, expect, it } from "vitest";

import { replaceArchivedAssetUrls } from "./mediaArchive";

describe("replaceArchivedAssetUrls", () => {
  it("replaces remote markdown and html image URLs with local asset URLs", () => {
    const htmlContent =
      '![one](https://example.test/one.jpg)\n\n<img src="https://example.test/two.jpg">';

    expect(
      replaceArchivedAssetUrls(htmlContent, [
        {
          originalUrl: "https://example.test/one.jpg",
          assetUrl: "/api/assets/asset-one",
        },
        {
          originalUrl: "https://example.test/two.jpg",
          assetUrl: "/api/assets/asset-two",
        },
      ]),
    ).toBe(
      '![one](/api/assets/asset-one)\n\n<img src="/api/assets/asset-two">',
    );
  });

  it("replaces URLs escaped in html attributes", () => {
    const htmlContent =
      '<video src="https://video.test/live.mp4?sign=abc&amp;t=123"></video>';

    expect(
      replaceArchivedAssetUrls(htmlContent, [
        {
          originalUrl: "https://video.test/live.mp4?sign=abc&t=123",
          assetUrl: "/api/assets/live-video",
        },
      ]),
    ).toBe('<video src="/api/assets/live-video"></video>');
  });
});
