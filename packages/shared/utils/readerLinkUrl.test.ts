import { describe, expect, test } from "vitest";

import { normalizeReaderLinkUrl } from "./readerLinkUrl";

describe("normalizeReaderLinkUrl", () => {
  test("resolves a reader relative link against the bookmark URL", () => {
    expect(
      normalizeReaderLinkUrl(
        "/t/%E5%BE%AE%E4%BF%A1?type=12",
        "https://www.coolapk.com/feed/72921796",
      ),
    ).toBe("https://www.coolapk.com/t/%E5%BE%AE%E4%BF%A1?type=12");
  });

  test("preserves absolute web and communication links", () => {
    expect(
      normalizeReaderLinkUrl(
        "https://github.com/karakeep-app/karakeep",
        "https://www.coolapk.com/feed/72921796",
      ),
    ).toBe("https://github.com/karakeep-app/karakeep");
    expect(
      normalizeReaderLinkUrl(
        "mailto:test@example.com",
        "https://www.coolapk.com/feed/72921796",
      ),
    ).toBe("mailto:test@example.com");
  });

  test("ignores anchors and unsafe script links", () => {
    expect(
      normalizeReaderLinkUrl("#comments", "https://www.coolapk.com/feed/1"),
    ).toBeNull();
    expect(
      normalizeReaderLinkUrl(
        "javascript:alert(1)",
        "https://www.coolapk.com/feed/1",
      ),
    ).toBeNull();
  });
});
