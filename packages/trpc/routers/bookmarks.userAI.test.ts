import { beforeEach, expect, it, vi } from "vitest";
import { getInMemoryDB } from "@karakeep/db/drizzle";
import { users } from "@karakeep/db/schema";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import { createCallerFactory } from "../index";
import { bookmarksAppRouter } from "./bookmarks";
import { UserAIError } from "@karakeep/shared-server";

const m = vi.hoisted(() => ({ client: vi.fn(), global: vi.fn() }));
vi.mock("@karakeep/shared-server", async (original) => ({
  ...(await original<typeof import("@karakeep/shared-server")>()),
  getUserAIClient: m.client,
  UserAIError: class extends Error {
    constructor(code: string) {
      super(`${code}: Configure your personal AI connection first.`);
    }
  },
  LinkCrawlerQueue: { enqueue: vi.fn() },
  OpenAIQueue: { enqueue: vi.fn() },
  EmbeddingsQueue: { enqueue: vi.fn() },
  RuleEngineQueue: { enqueue: vi.fn() },
  triggerSearchReindex: vi.fn(),
}));
vi.mock("@karakeep/shared/inference", async (original) => ({
  ...(await original<typeof import("@karakeep/shared/inference")>()),
  InferenceClientFactory: { build: m.global },
}));
beforeEach(() => {
  vi.clearAllMocks();
  m.client.mockResolvedValue(null);
  m.global.mockReturnValue(null);
});
async function buildTestContext(_seed: boolean) {
  const db = getInMemoryDB(true);
  const owners = await db
    .insert(users)
    .values([
      { name: "Owner", email: "owner@example.com" },
      { name: "Other", email: "other@example.com" },
    ])
    .returning();
  const caller = createCallerFactory(bookmarksAppRouter);
  return {
    db,
    apiCallers: owners.map((user) => ({
      bookmarks: caller({
        db,
        user: { ...user, role: "user" },
        auth: { type: "session" },
        req: { ip: null },
      }),
    })),
  };
}
it("uses the current actor's personal configuration and gives a safe missing-config error", async () => {
  const { apiCallers, db } = await buildTestContext(true);
  const bookmark = await apiCallers[0].bookmarks.createBookmark({
    type: BookmarkTypes.LINK,
    url: "https://example.com",
  });
  const actor = await db.query.bookmarks.findFirst();
  await expect(
    apiCallers[0].bookmarks.summarizeBookmark({ bookmarkId: bookmark.id }),
  ).rejects.toThrow(/UNCONFIGURED/);
  expect(m.client).toHaveBeenCalledWith(db, actor!.userId, "text");
  expect(m.global).not.toHaveBeenCalled();
});
it("checks content ownership before resolving a paid personal client", async () => {
  const { apiCallers } = await buildTestContext(true);
  const bookmark = await apiCallers[0].bookmarks.createBookmark({
    type: BookmarkTypes.LINK,
    url: "https://example.com",
  });
  await expect(
    apiCallers[1].bookmarks.summarizeBookmark({ bookmarkId: bookmark.id }),
  ).rejects.toThrow();
  expect(m.client).not.toHaveBeenCalled();
  expect(m.global).not.toHaveBeenCalled();
});
it("returns safe personal configuration errors without a global retry", async () => {
  const { apiCallers } = await buildTestContext(true);
  const bookmark = await apiCallers[0].bookmarks.createBookmark({
    type: BookmarkTypes.LINK,
    url: "https://example.com",
  });
  m.client.mockRejectedValue(new UserAIError("DECRYPTION_FAILED"));
  await expect(
    apiCallers[0].bookmarks.summarizeBookmark({ bookmarkId: bookmark.id }),
  ).rejects.toThrow(/DECRYPTION_FAILED/);
  expect(m.global).not.toHaveBeenCalled();
});
it("keeps two actors' personal summary configuration lookups disjoint", async () => {
  const { apiCallers, db } = await buildTestContext(true);
  for (const [index, api] of apiCallers.entries()) {
    const bookmark = await api.bookmarks.createBookmark({
      type: BookmarkTypes.LINK,
      url: `https://example.com/${index}`,
    });
    await expect(
      api.bookmarks.summarizeBookmark({ bookmarkId: bookmark.id }),
    ).rejects.toThrow(/UNCONFIGURED/);
  }
  const owners = await db.query.users.findMany();
  expect(new Set(m.client.mock.calls.map((call) => call[1]))).toEqual(
    new Set(owners.map((owner) => owner.id)),
  );
  expect(m.global).not.toHaveBeenCalled();
});
