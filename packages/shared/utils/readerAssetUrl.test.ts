import { describe, expect, test } from "vitest";

import { normalizeReaderHtmlAssetUrls } from "./readerAssetUrl";

describe("normalizeReaderHtmlAssetUrls", () => {
  test("rewrites localhost public asset urls to the app server origin", () => {
    expect(
      normalizeReaderHtmlAssetUrls(
        '<article><img src="http://localhost:13000/api/public/assets/asset-1?token=abc"></article>',
        "http://192.168.31.10:13000",
      ),
    ).toBe(
      '<article><img src="http://192.168.31.10:13000/api/public/assets/asset-1?token=abc"></article>',
    );
  });

  test("rewrites relative public asset urls to the app server origin", () => {
    expect(
      normalizeReaderHtmlAssetUrls(
        '<article><img src="/api/public/assets/asset-1?token=abc"></article>',
        "http://192.168.31.10:13000",
      ),
    ).toBe(
      '<article><img src="http://192.168.31.10:13000/api/public/assets/asset-1?token=abc"></article>',
    );
  });

  test("keeps non-asset image urls unchanged", () => {
    expect(
      normalizeReaderHtmlAssetUrls(
        '<article><img src="https://example.com/image.jpg"></article>',
        "http://192.168.31.10:13000",
      ),
    ).toBe('<article><img src="https://example.com/image.jpg"></article>');
  });
});
