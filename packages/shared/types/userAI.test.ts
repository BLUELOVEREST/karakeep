import { describe, expect, it } from "vitest";

import { sortUserAIModels, zUserAISave } from "./userAI";

describe("user AI contracts", () => {
  it("deduplicates exact IDs and naturally sorts namespaces and models", () => {
    expect(
      sortUserAIModels([
        "gpt-10",
        "google/model-10",
        "gpt-2",
        "anthropic/model-2",
        "google/model-2",
        "gpt-2",
        "GPT-2",
      ]),
    ).toEqual([
      { id: "anthropic/model-2", group: "anthropic" },
      { id: "google/model-2", group: "google" },
      { id: "google/model-10", group: "google" },
      { id: "GPT-2", group: null },
      { id: "gpt-2", group: null },
      { id: "gpt-10", group: null },
    ]);
  });
  it("does not guess vendors or rewrite model IDs", () => {
    expect(
      sortUserAIModels(["local-model:10", "deepseek-chat", "claude-2"]),
    ).toEqual([
      { id: "claude-2", group: null },
      { id: "deepseek-chat", group: null },
      { id: "local-model:10", group: null },
    ]);
  });
  it("requires a revision and model when enabling a profile", () => {
    const draft = {
      enabled: true,
      provider: "openai",
      baseUrl: "https://api.example/v1",
      textModel: "",
      imageModel: null,
      outputSchema: "structured",
      useMaxCompletionTokens: false,
    };
    expect(zUserAISave.safeParse(draft).success).toBe(false);
    expect(zUserAISave.safeParse({ ...draft, revision: 0 }).success).toBe(
      false,
    );
    expect(
      zUserAISave.safeParse({ ...draft, textModel: "model-2", revision: 0 })
        .success,
    ).toBe(true);
  });
});
