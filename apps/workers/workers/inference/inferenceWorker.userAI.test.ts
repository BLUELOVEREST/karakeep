import { beforeEach, expect, it, vi } from "vitest";
import { OpenAiWorker } from "./inferenceWorker";

const m = vi.hoisted(() => ({
  owner: vi.fn(),
  user: vi.fn(),
  client: vi.fn(),
  global: vi.fn(),
  tag: vi.fn(),
  summary: vi.fn(),
  set: vi.fn(),
  runner: vi.fn(),
}));
vi.mock("metrics", () => ({
  workerStatsCounter: { labels: () => ({ inc: vi.fn() }) },
}));
vi.mock("workerTracing", () => ({
  withWorkerTracing: (_: string, fn: unknown) => fn,
  withWorkerEventLog: (_: string, fn: unknown) => fn,
}));
vi.mock("@karakeep/db", () => ({
  db: {
    query: { bookmarks: { findFirst: m.owner }, users: { findFirst: m.user } },
    update: () => ({
      set: (value: unknown) => {
        m.set(value);
        return { where: vi.fn() };
      },
    }),
  },
}));
vi.mock("@karakeep/shared-server", () => ({
  getUserAIClient: m.client,
  addLogFields: vi.fn(),
  OpenAIQueue: {},
  zOpenAIRequestSchema: {
    safeParse: (data: { bookmarkId?: string }) =>
      data.bookmarkId
        ? { success: true, data }
        : { success: false, error: "invalid" },
    parse: (data: unknown) => data,
  },
}));
vi.mock("@karakeep/shared/inference", () => ({
  InferenceClientFactory: { build: m.global },
}));
vi.mock("@karakeep/shared/queueing", () => ({
  getQueueClient: async () => ({ createRunner: m.runner }),
}));
vi.mock("./tagging", () => ({ runTagging: m.tag }));
vi.mock("./summarize", () => ({ runSummarization: m.summary }));

beforeEach(() => {
  vi.clearAllMocks();
  m.owner.mockResolvedValue({ userId: "owner", asset: null });
  m.user.mockResolvedValue({
    autoTaggingEnabled: null,
    autoSummarizationEnabled: true,
  });
  m.client.mockResolvedValue({ personal: true });
  m.global.mockReturnValue({ global: true });
  m.tag.mockResolvedValue("completed");
  m.summary.mockResolvedValue("skipped");
});
async function setup(type = "tag") {
  await OpenAiWorker.build();
  const callbacks = m.runner.mock.calls[0][1];
  const job = {
    id: "job",
    data: { bookmarkId: "bookmark", type },
    abortSignal: new AbortController().signal,
  };
  return { callbacks, job };
}
it.each([
  ["tag", { autoTaggingEnabled: false }],
  ["summarize", { autoSummarizationEnabled: false }],
  ["summarize", { autoSummarizationEnabled: null }],
])(
  "skips disabled %s preferences before loading credentials",
  async (type, preferences) => {
    m.user.mockResolvedValue(preferences);
    m.client.mockRejectedValue(new Error("irrelevant decryption failure"));
    const { callbacks, job } = await setup(type as string);
    const result = await callbacks.run(job);
    expect(result).toBe("skipped");
    await callbacks.onComplete(job, result);
    expect(m.client).not.toHaveBeenCalled();
    expect(m.global).not.toHaveBeenCalled();
    expect(m.set).toHaveBeenCalledWith(
      type === "tag" ? { taggingStatus: null } : { summarizationStatus: null },
    );
  },
);
it("selects the bookmark owner's client after owner lookup, never the global client", async () => {
  const { callbacks, job } = await setup();
  expect(await callbacks.run(job)).toBe("completed");
  expect(m.client).toHaveBeenCalledWith(expect.anything(), "owner", "text");
  expect(m.owner.mock.invocationCallOrder[0]).toBeLessThan(
    m.client.mock.invocationCallOrder[0],
  );
  expect(m.global).not.toHaveBeenCalled();
});
it("selects vision only for image tagging", async () => {
  m.owner.mockResolvedValue({
    userId: "image-owner",
    asset: { assetType: "image" },
  });
  const { callbacks, job } = await setup();
  await callbacks.run(job);
  expect(m.client).toHaveBeenCalledWith(
    expect.anything(),
    "image-owner",
    "vision",
  );
});
it("skips images without vision rather than using a text or global client", async () => {
  m.owner.mockResolvedValue({ userId: "owner", asset: { assetType: "image" } });
  m.client.mockResolvedValue(null);
  const { callbacks, job } = await setup();
  const result = await callbacks.run(job);
  await callbacks.onComplete(job, result);
  expect(result).toBe("skipped");
  expect(m.set).toHaveBeenCalledWith({ taggingStatus: null });
  expect(m.client).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    "owner",
    "vision",
  );
  expect(m.tag).not.toHaveBeenCalled();
  expect(m.global).not.toHaveBeenCalled();
});
it("resolves the latest owner configuration separately for every queued job", async () => {
  const { callbacks, job } = await setup();
  await callbacks.run(job);
  m.owner.mockResolvedValue({ userId: "other-owner", asset: null });
  m.client.mockResolvedValue(null);
  expect(await callbacks.run(job)).toBe("skipped");
  expect(m.client.mock.calls.map((call) => call[1])).toEqual([
    "owner",
    "other-owner",
  ]);
  expect(m.tag).toHaveBeenCalledOnce();
});
it("clears status when personal AI is unavailable without falling back", async () => {
  m.client.mockResolvedValue(null);
  const { callbacks, job } = await setup();
  const result = await callbacks.run(job);
  expect(result).toBe("skipped");
  await callbacks.onComplete(job, result);
  expect(m.set).toHaveBeenCalledWith({ taggingStatus: null });
  expect(m.tag).not.toHaveBeenCalled();
  expect(m.global).not.toHaveBeenCalled();
});
it("propagates content/preference skips instead of marking summary success", async () => {
  const { callbacks, job } = await setup("summarize");
  const result = await callbacks.run(job);
  expect(result).toBe("skipped");
  await callbacks.onComplete(job, result);
  expect(m.set).toHaveBeenCalledWith({ summarizationStatus: null });
});
it("marks actual completed inference successful", async () => {
  const { callbacks, job } = await setup();
  await callbacks.onComplete(job, await callbacks.run(job));
  expect(m.set).toHaveBeenCalledWith({ taggingStatus: "success" });
});
it("rejects malformed jobs and missing bookmarks before client construction", async () => {
  const { callbacks, job } = await setup();
  await expect(callbacks.run({ ...job, data: {} })).rejects.toThrow();
  m.owner.mockResolvedValue(undefined);
  await expect(callbacks.run(job)).rejects.toThrow();
  expect(m.client).not.toHaveBeenCalled();
  expect(m.global).not.toHaveBeenCalled();
});
