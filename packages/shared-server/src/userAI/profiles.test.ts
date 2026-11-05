import { beforeEach, describe, expect, it } from "vitest";
import { getInMemoryDB } from "@karakeep/db/drizzle";
import { userAIConfigs, users } from "@karakeep/db/schema";
import { UserAIProfiles } from "./profiles";

describe("personal AI profiles", () => {
  let db: ReturnType<typeof getInMemoryDB>;
  let store: UserAIProfiles;
  const masterKey = Buffer.alloc(32, 7).toString("base64");
  const draft = {
    enabled: true,
    provider: "openai" as const,
    baseUrl: "https://api.example/v1/",
    textModel: "vendor/model-2",
    imageModel: null,
    outputSchema: "structured" as const,
    useMaxCompletionTokens: false,
    revision: 0,
    apiKey: "private-token",
  };
  beforeEach(() => {
    db = getInMemoryDB(true);
    db.insert(users)
      .values([
        { id: "alice", name: "Alice", email: "alice@example.com" },
        { id: "bob", name: "Bob", email: "bob@example.com" },
      ])
      .run();
    store = new UserAIProfiles(db, masterKey);
  });
  it("defaults disabled and isolates encrypted credentials by owner", () => {
    expect(store.get("bob")).toMatchObject({
      enabled: false,
      revision: 0,
      keyConfigured: false,
    });
    const saved = store.save("alice", draft);
    expect(saved).toMatchObject({
      revision: 1,
      keyConfigured: true,
      baseUrl: "https://api.example/v1",
    });
    expect(JSON.stringify(saved)).not.toContain("private-token");
    expect(
      db.select().from(userAIConfigs).get()?.encryptedApiKey,
    ).not.toContain("private-token");
    expect(store.resolveEnabled("bob")).toBeNull();
    expect(store.resolveEnabled("alice")?.apiKey).toBe("private-token");
    expect(store.resolveEnabled("alice", "vision")).toBeNull();
  });
  it("retains blank keys only for the same connection and rejects stale writes", () => {
    store.save("alice", draft);
    expect(() => store.save("alice", draft)).toThrow("CONFLICT");
    store.save("alice", {
      ...draft,
      revision: 1,
      apiKey: "",
      textModel: "new-model",
    });
    expect(store.resolveEnabled("alice")?.apiKey).toBe("private-token");
    expect(() =>
      store.save("alice", {
        ...draft,
        revision: 2,
        apiKey: "",
        baseUrl: "https://other.example/v1",
      }),
    ).toThrow("KEY_REENTRY_REQUIRED");
    expect(() =>
      store.resolveDraft("alice", { ...draft, revision: 0 }),
    ).toThrow("CONFLICT");
  });
  it("clearing disables AI persistently and does not resurrect a key", () => {
    store.save("alice", draft);
    expect(store.clearKey("alice", 1)).toMatchObject({
      enabled: false,
      keyConfigured: false,
      revision: 2,
    });
    expect(
      new UserAIProfiles(db, masterKey).resolveEnabled("alice"),
    ).toBeNull();
    expect(() =>
      store.save("alice", { ...draft, revision: 2, apiKey: "" }),
    ).toThrow("KEY_REQUIRED");
  });
  it("fails closed when encryption configuration is missing or rotated", () => {
    expect(() => new UserAIProfiles(db, "").save("alice", draft)).toThrow(
      "ENCRYPTION_KEY_MISSING",
    );
    store.save("alice", draft);
    expect(() =>
      new UserAIProfiles(
        db,
        Buffer.alloc(32, 9).toString("base64"),
      ).resolveEnabled("alice"),
    ).toThrow("DECRYPTION_FAILED");
  });
});
