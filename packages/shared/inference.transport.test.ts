import { beforeEach, expect, it, vi } from "vitest";

import {
  OllamaInferenceClient,
  OpenAIEmbeddingClient,
  OpenAIInferenceClient,
} from "./inference";
import type { OpenAIInferenceConfig, OllamaInferenceConfig } from "./inference";
import logger from "./logger";

const custom = vi.hoisted(() => ({ create: vi.fn(() => vi.fn()) }));
vi.mock("./customFetch", () => ({ createCustomFetch: custom.create }));

const config: OpenAIInferenceConfig = {
  apiKey: "personal",
  baseURL: "https://example.com/prefix",
  textModel: "text",
  imageModel: "vision",
  contextLength: 2048,
  maxOutputTokens: 128,
  useMaxCompletionTokens: false,
  outputSchema: "plain",
};
const ollama: OllamaInferenceConfig = {
  baseUrl: "https://example.com/prefix",
  textModel: "text",
  imageModel: "vision",
  contextLength: 2048,
  maxOutputTokens: 128,
  outputSchema: "plain",
};

beforeEach(() => {
  vi.clearAllMocks();
});

it("uses injected OpenAI fetch and retries without creating a proxy fetch", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({ choices: [{ message: { content: "ok" } }] }),
    );
  const client = new OpenAIInferenceClient({ ...config, fetch, maxRetries: 0 });
  expect(await client.inferFromText("hello", {})).toMatchObject({
    response: "ok",
  });
  expect(client.openAI.maxRetries).toBe(0);
  expect(fetch).toHaveBeenCalledOnce();
  expect(custom.create).not.toHaveBeenCalled();
});

it("preserves OpenAI default retries and custom fetch defaults", () => {
  const client = new OpenAIInferenceClient(config);
  expect(client.openAI.maxRetries).toBe(2);
  expect(custom.create).toHaveBeenCalledOnce();
});

it("accepts injected fetch and zero retries for the embedding builder too", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () => new Response("{}", { status: 500 }));
  const client = new OpenAIEmbeddingClient({
    apiKey: "personal",
    fetch,
    maxRetries: 0,
  });
  await expect(
    client.generateEmbeddingFromText(["hello"]),
  ).rejects.toBeDefined();
  expect(fetch).toHaveBeenCalledOnce();
  expect(custom.create).not.toHaveBeenCalled();
});

it("rejects strict Ollama malformed JSON without logging partial responses", async () => {
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response('{"response":"partial"}\n{"error":"SECRET"}\n'),
    );
  const client = new OllamaInferenceClient({
    ...ollama,
    fetch,
    strictErrors: true,
  });
  await expect(client.inferFromText("hello", {})).rejects.toThrow();
  expect(warn).not.toHaveBeenCalled();
  expect(custom.create).not.toHaveBeenCalled();
  warn.mockRestore();
});

it("uses nonstreaming generation and validates the complete strict response", async () => {
  const fetch = vi.fn().mockImplementation(async () =>
    Response.json({
      response: "complete",
      done: true,
      eval_count: 2,
      prompt_eval_count: 3,
    }),
  );
  const client = new OllamaInferenceClient({
    ...ollama,
    fetch,
    strictErrors: true,
  });
  expect(await client.inferFromText("hello", {})).toEqual({
    response: "complete",
    totalTokens: 5,
  });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    stream: false,
    model: "text",
  });
  for (const body of [
    null,
    [],
    {},
    { response: "partial", done: false },
    { response: 123, done: true },
    { response: "ok", done: true, error: "SECRET" },
    { response: "ok", done: true, eval_count: "2" },
    { response: "ok", done: true, eval_count: -1 },
    { response: " ", done: true },
  ]) {
    fetch.mockImplementation(async () => Response.json(body));
    await expect(client.inferFromText("hello", {})).rejects.toThrow(
      "Invalid inference response.",
    );
  }
});

it("retains legacy Ollama partial response behavior by default", async () => {
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response('{"response":"partial"}\n{"error":"SECRET"}\n'),
    );
  const client = new OllamaInferenceClient({ ...ollama, fetch });
  expect(await client.inferFromText("hello", {})).toMatchObject({
    response: "partial",
    totalTokens: NaN,
  });
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});
