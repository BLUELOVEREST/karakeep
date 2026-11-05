import { beforeEach, expect, it, vi } from "vitest";
import { readImageTextWithLLM } from "./assetPreprocessingWorker";

const m = vi.hoisted(() => ({
  client: vi.fn(),
  global: vi.fn(),
  infer: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
}));
vi.mock("@karakeep/db", () => ({ db: {} }));
vi.mock("metrics", () => ({ workerStatsCounter: {} }));
vi.mock("workerTracing", () => ({
  withWorkerTracing: vi.fn(),
  withWorkerEventLog: vi.fn(),
}));
vi.mock("@karakeep/shared-server", () => ({ getUserAIClient: m.client }));
vi.mock("@karakeep/shared/inference", () => ({
  InferenceClientFactory: { build: m.global },
}));
vi.mock("tesseract.js", () => ({
  createWorker: async () => ({
    recognize: m.recognize,
    terminate: m.terminate,
  }),
}));
vi.mock("@karakeep/shared/config", () => ({
  default: { ocr: { langs: ["eng"], confidenceThreshold: 0 } },
}));
beforeEach(() => {
  vi.clearAllMocks();
  m.client.mockResolvedValue({ inferFromImage: m.infer });
  m.infer.mockResolvedValue({ response: " personal OCR " });
  m.recognize.mockResolvedValue({
    data: { text: "local OCR", confidence: 99 },
  });
});
it("uses only the asset owner's vision client and propagates cancellation", async () => {
  const signal = new AbortController().signal;
  expect(
    await readImageTextWithLLM(
      Buffer.from("image"),
      "image/png",
      "owner",
      signal,
    ),
  ).toBe("personal OCR");
  expect(m.client).toHaveBeenCalledWith(expect.anything(), "owner", "vision");
  expect(m.infer).toHaveBeenCalledWith(
    expect.any(String),
    "image/png",
    expect.any(String),
    { schema: null, abortSignal: signal },
  );
  expect(m.global).not.toHaveBeenCalled();
});
it("falls back to local OCR when personal vision is unavailable", async () => {
  m.client.mockResolvedValue(null);
  expect(
    await readImageTextWithLLM(
      Buffer.from("image"),
      "image/png",
      "owner",
      new AbortController().signal,
    ),
  ).toBe("local OCR");
  expect(m.terminate).toHaveBeenCalledOnce();
  expect(m.global).not.toHaveBeenCalled();
});
