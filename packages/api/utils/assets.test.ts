import { describe, expect, it } from "vitest";

import { getServedAssetContentType } from "./assets";

describe("getServedAssetContentType", () => {
  it("serves HTML assets with an explicit UTF-8 charset", () => {
    expect(getServedAssetContentType("text/html")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("keeps non-HTML asset content types unchanged", () => {
    expect(getServedAssetContentType("image/png")).toBe("image/png");
  });
});
