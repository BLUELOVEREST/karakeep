import { afterEach, beforeEach, describe, expect, it } from "vitest";
import serverConfig from "@karakeep/shared/config";
import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach } from "../testUtils";

describe("personal AI API", () => {
  const originalKey = serverConfig.userAI.encryptionKey;
  afterEach(() => {
    serverConfig.userAI.encryptionKey = originalKey;
  });
  beforeEach(defaultBeforeEach());
  beforeEach(() => {
    serverConfig.userAI.encryptionKey = Buffer.alloc(32, 4).toString("base64");
  });
  const input = {
    enabled: true,
    provider: "openai" as const,
    baseUrl: "https://example.com/v1",
    apiKey: "test-private-api-key",
    textModel: "vendor/model",
    imageModel: null,
    outputSchema: "json" as const,
    useMaxCompletionTokens: false,
    revision: 0,
  };
  it("requires authentication", async (ctx: CustomTestContext) => {
    await expect(ctx.unauthedAPICaller.userAI.get()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("keeps profiles private and never returns secrets", async (ctx: CustomTestContext) => {
    const [alice, bob] = ctx.apiCallers;
    const saved = await alice.userAI.save(input);
    expect(saved.keyConfigured).toBe(true);
    expect(JSON.stringify(saved)).not.toMatch(
      /test-private-api-key|encryptedApiKey/,
    );
    expect(await bob.userAI.get()).toMatchObject({
      enabled: false,
      keyConfigured: false,
      revision: 0,
    });
    expect(await alice.userAI.get()).toMatchObject({
      enabled: true,
      revision: 1,
    });
    await expect(alice.userAI.save(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await alice.userAI.clearKey({ revision: 1 })).toMatchObject({
      enabled: false,
      keyConfigured: false,
      revision: 2,
    });
  });
});
