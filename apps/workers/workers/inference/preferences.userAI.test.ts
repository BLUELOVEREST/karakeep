import { beforeEach, expect, it, vi } from "vitest";
import { runTagging } from "./tagging";
import { runSummarization } from "./summarize";
import { UserAIError } from "@karakeep/shared-server";

const m = vi.hoisted(() => ({
  bookmark: vi.fn(),
  user: vi.fn(),
  infer: vi.fn(),
  reindex: vi.fn(),
  log: vi.fn(),
}));
vi.mock("network", () => ({ getBookmarkDomain: vi.fn() }));
vi.mock("trpc", () => ({ buildImpersonatingTRPCClient: vi.fn() }));
vi.mock("@karakeep/db", () => ({
  db: {
    query: {
      bookmarks: { findFirst: m.bookmark },
      users: { findFirst: m.user },
      customPrompts: { findMany: async () => [] },
    },
    update: () => ({ set: () => ({ where: vi.fn() }) }),
    transaction: async () => ({ detachedTags: [], attachedTags: [] }),
  },
}));
vi.mock("@karakeep/shared-server", async (original) => ({
  ...(await original<typeof import("@karakeep/shared-server")>()),
  addLogFields: vi.fn(),
  setSpanAttributes: vi.fn(),
  triggerSearchReindex: m.reindex,
}));
vi.mock("@karakeep/shared/logger", () => ({
  default: {
    info: m.log,
    debug: m.log,
    warn: m.log,
    error: m.log,
  },
}));
vi.mock("@karakeep/shared/vectorStore", () => ({
  getVectorStoreClient: async () => null,
}));
vi.mock("@karakeep/shared/config", () => ({
  default: {
    inference: {
      enableAutoTagging: false,
      enableAutoSummarization: false,
      contextLength: 1000,
      inferredTagLang: "english",
    },
  },
}));
vi.mock("@karakeep/shared/prompts.server", () => ({
  buildTextPrompt: async () => "tags",
  buildSummaryPrompt: async () => "summary",
}));
vi.mock("@karakeep/trpc/models/bookmarks", () => ({
  Bookmark: { getBookmarkPlainTextContent: async () => "content" },
}));
vi.mock("@karakeep/trpc/lib/ruleEngine", () => ({
  RuleEngine: { triggerOnEvent: vi.fn() },
}));
vi.mock("@karakeep/trpc/models/webhooks.service", () => ({
  WebhooksService: class {
    triggerWebhook = vi.fn();
  },
}));
const job = {
  id: "job",
  data: { bookmarkId: "bookmark", type: "tag" as const },
  priority: 1,
  runNumber: 1,
  abortSignal: new AbortController().signal,
};
const client = { inferFromText: m.infer } as unknown as Parameters<
  typeof runTagging
>[2];
beforeEach(() => {
  vi.clearAllMocks();
  m.bookmark.mockResolvedValue({
    id: "bookmark",
    userId: "owner",
    type: "link",
    link: { url: "https://example.com", description: "content" },
  });
  m.user.mockResolvedValue({
    autoTaggingEnabled: null,
    autoSummarizationEnabled: null,
  });
  m.infer.mockResolvedValue({ response: '{"tags":[]}', totalTokens: 1 });
});
it("defaults null tagging to enabled and ignores the global gate", async () => {
  expect(await runTagging("bookmark", job, client)).toBe("completed");
  expect(m.infer).toHaveBeenCalledOnce();
});
it("skips explicitly disabled tagging", async () => {
  m.user.mockResolvedValue({ autoTaggingEnabled: false });
  expect(await runTagging("bookmark", job, client)).toBe("skipped");
  expect(m.infer).not.toHaveBeenCalled();
});
it("defaults null summarization to disabled", async () => {
  expect(await runSummarization("bookmark", job, client)).toBe("skipped");
  expect(m.infer).not.toHaveBeenCalled();
});
it("skips explicitly disabled summaries", async () => {
  m.user.mockResolvedValue({ autoSummarizationEnabled: false });
  expect(await runSummarization("bookmark", job, client)).toBe("skipped");
  expect(m.infer).not.toHaveBeenCalled();
});
it("runs explicitly enabled summary despite global gate", async () => {
  m.user.mockResolvedValue({ autoSummarizationEnabled: true });
  m.infer.mockResolvedValue({ response: "summary", totalTokens: 1 });
  expect(await runSummarization("bookmark", job, client)).toBe("completed");
  expect(m.reindex).toHaveBeenCalledOnce();
});
it("propagates unsupported summary content as skipped", async () => {
  m.user.mockResolvedValue({ autoSummarizationEnabled: true });
  m.bookmark.mockResolvedValue({
    id: "bookmark",
    userId: "owner",
    type: "asset",
  });
  expect(await runSummarization("bookmark", job, client)).toBe("skipped");
  expect(m.infer).not.toHaveBeenCalled();
});
it.each([
  "sk-echoed-secret-malformed-json",
  '{"tags":[{"sk-echoed-secret":"invalid tag"}]}',
])(
  "never exposes malformed upstream content in errors or logs: %s",
  async (response) => {
    m.infer.mockResolvedValue({ response, totalTokens: 1 });
    const error = await runTagging("bookmark", job, client).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(UserAIError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE" });
    expect(String(error)).not.toContain("sk-echoed-secret");
    expect(JSON.stringify(error)).not.toContain("sk-echoed-secret");
    expect(JSON.stringify(m.log.mock.calls)).not.toContain("sk-echoed-secret");
  },
);
it("logs only generated tag counts, not upstream tag content", async () => {
  m.infer.mockResolvedValue({
    response: '{"tags":["sk-echoed-secret"]}',
    totalTokens: 1,
  });
  expect(await runTagging("bookmark", job, client)).toBe("completed");
  expect(JSON.stringify(m.log.mock.calls)).not.toContain("sk-echoed-secret");
  expect(m.log).toHaveBeenCalledWith(
    expect.stringContaining("inferred 1 tags"),
  );
});
