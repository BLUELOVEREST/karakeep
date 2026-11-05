import { describe, expect, it } from "vitest";
import { resolveInferenceLanguage } from "./aiLanguage";

describe("inference language", () => {
  it("defaults to simplified Chinese without a server language fallback", () => {
    expect(resolveInferenceLanguage(null)).toBe("Simplified Chinese");
  });
  it("follows the saved interface language for background jobs", () => {
    expect(resolveInferenceLanguage("interface", "zhtw")).toBe(
      "Traditional Chinese",
    );
    expect(resolveInferenceLanguage("interface", "ja")).toBe("Japanese");
    expect(resolveInferenceLanguage("interface")).toBe("English");
  });
  it("preserves explicit and legacy custom languages", () => {
    expect(resolveInferenceLanguage("Klingon", "zh")).toBe("Klingon");
    expect(resolveInferenceLanguage("english", "zh")).toBe("english");
  });
});
