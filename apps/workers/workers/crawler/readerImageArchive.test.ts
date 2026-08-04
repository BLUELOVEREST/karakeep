import { describe, expect, it, vi } from "vitest";

import { archiveReaderImages } from "./readerImageArchive";

describe("archiveReaderImages", () => {
  it("downloads remote reader images with the page URL as referer and rewrites them to local assets", async () => {
    const archiveImage = vi
      .fn()
      .mockResolvedValueOnce({ assetId: "asset-one" })
      .mockResolvedValueOnce({ assetId: "asset-two" });

    const result = await archiveReaderImages({
      htmlContent:
        '<article><img src="https://cdn.example.test/one.webp"><img src="/relative/two.png"></article>',
      pageUrl: "https://example.test/post/1",
      archiveImage,
    });

    expect(archiveImage).toHaveBeenCalledTimes(2);
    expect(archiveImage).toHaveBeenNthCalledWith(
      1,
      "https://cdn.example.test/one.webp",
      "https://example.test/post/1",
    );
    expect(archiveImage).toHaveBeenNthCalledWith(
      2,
      "https://example.test/relative/two.png",
      "https://example.test/post/1",
    );
    expect(result.htmlContent).toContain('src="/api/assets/asset-one"');
    expect(result.htmlContent).toContain('src="/api/assets/asset-two"');
    expect(result.archivedAssets).toEqual([
      {
        originalUrl: "https://cdn.example.test/one.webp",
        assetId: "asset-one",
      },
      {
        originalUrl: "https://example.test/relative/two.png",
        assetId: "asset-two",
      },
    ]);
  });

  it("deduplicates remote image downloads and skips local or inline images", async () => {
    const archiveImage = vi.fn().mockResolvedValue({ assetId: "asset-one" });

    const result = await archiveReaderImages({
      htmlContent:
        '<article><img src="https://cdn.example.test/one.webp"><img src="https://cdn.example.test/one.webp"><img src="/api/assets/existing"><img src="data:image/png;base64,abc"></article>',
      pageUrl: "https://example.test/post/1",
      archiveImage,
    });

    expect(archiveImage).toHaveBeenCalledTimes(1);
    expect(result.htmlContent.match(/\/api\/assets\/asset-one/g)).toHaveLength(
      2,
    );
    expect(result.htmlContent).toContain('src="/api/assets/existing"');
    expect(result.htmlContent).toContain('src="data:image/png;base64,abc"');
  });

  it("keeps the original image URL when downloading fails", async () => {
    const archiveImage = vi.fn().mockResolvedValue(null);

    const result = await archiveReaderImages({
      htmlContent:
        '<article><img src="https://cdn.example.test/one.webp"></article>',
      pageUrl: "https://example.test/post/1",
      archiveImage,
    });

    expect(result.htmlContent).toContain(
      'src="https://cdn.example.test/one.webp"',
    );
    expect(result.archivedAssets).toEqual([]);
  });

  it("records failed image downloads without failing the whole archive", async () => {
    const archiveImage = vi
      .fn()
      .mockRejectedValue(new Error("Failed to download reader image: 403"));

    const result = await archiveReaderImages({
      htmlContent:
        '<article><img src="https://cdn.example.test/one.webp"></article>',
      pageUrl: "https://example.test/post/1",
      archiveImage,
    });

    expect(result.htmlContent).toContain(
      'src="https://cdn.example.test/one.webp"',
    );
    expect(result.archivedAssets).toEqual([]);
    expect(result.failedImages).toEqual([
      {
        originalUrl: "https://cdn.example.test/one.webp",
        message: "Failed to download reader image: 403",
      },
    ]);
  });
});
