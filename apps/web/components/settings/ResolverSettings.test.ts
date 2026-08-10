import { describe, expect, it } from "vitest";

import { getSecretPlaceholder } from "./ResolverSettings";

describe("getSecretPlaceholder", () => {
  it("shows a masked replacement hint when a secret is configured", () => {
    expect(getSecretPlaceholder(true, "Paste XHS_COOKIE here.")).toBe(
      "Configured: ********. Paste a new value to replace it.",
    );
  });

  it("shows the normal placeholder when a secret is not configured", () => {
    expect(getSecretPlaceholder(false, "Paste XHS_COOKIE here.")).toBe(
      "Paste XHS_COOKIE here.",
    );
  });
});
