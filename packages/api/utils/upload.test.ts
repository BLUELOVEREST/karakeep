import { PassThrough } from "stream";
import { describe, expect, it } from "vitest";

import { sanitizeUploadFileName, toWebReadableStream } from "./upload";

describe("sanitizeUploadFileName", () => {
  it("preserves unicode file names", () => {
    expect(sanitizeUploadFileName("中文资料.pdf")).toBe("中文资料.pdf");
  });

  it("removes control characters and replaces path separators", () => {
    expect(sanitizeUploadFileName(" ../报告/2026\\final\u0000.pdf ")).toBe(
      ".._报告_2026_final.pdf",
    );
  });

  it("uses a fallback when the file name is empty after sanitization", () => {
    expect(sanitizeUploadFileName("\u0000\n\t")).toBe("upload");
  });
});

describe("toWebReadableStream", () => {
  it("destroys the node stream when the web stream is cancelled", async () => {
    const nodeStream = new PassThrough();
    const webStream = toWebReadableStream(nodeStream);
    const reader = webStream.getReader();

    await reader.cancel();

    expect(nodeStream.destroyed).toBe(true);
  });
});
