import { beforeEach, expect, it, vi } from "vitest";
import type { UserAISettings } from "@karakeep/shared/types/userAI";
import logger from "@karakeep/shared/logger";
import { UserAINetworkError } from "@karakeep/shared/userAINetwork";
import { createUserAIInferenceClient } from "./client";

const transport = vi.hoisted(() => ({ create: vi.fn(), fetch: vi.fn() }));
vi.mock("@karakeep/shared/userAINetwork", async (original) => ({
  ...(await original<object>()),
  createUserAIFetch: transport.create,
}));

const settings: UserAISettings = {
  enabled: true,
  provider: "openai",
  baseUrl: "https://example.com/prefix",
  textModel: "personal-text",
  imageModel: "personal-vision",
  outputSchema: "plain",
  useMaxCompletionTokens: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  transport.create.mockReturnValue(transport.fetch);
  transport.fetch.mockImplementation(async () =>
    Response.json({
      choices: [{ message: { content: "ok" } }],
      usage: { total_tokens: 3 },
    }),
  );
});

it("uses personal endpoint, credentials, model, bounded transport and no retries", async () => {
  const client = createUserAIInferenceClient(settings, "PERSONAL", [
    "https://private.example",
  ]);
  expect(await client.inferFromText("hello", {})).toEqual({
    response: "ok",
    totalTokens: 3,
  });
  expect(transport.create).toHaveBeenCalledWith(
    settings.baseUrl,
    expect.objectContaining({
      allowedPrivateOrigins: ["https://private.example"],
    }),
  );
  const [url, init] = transport.fetch.mock.calls[0];
  expect(String(url)).toBe("https://example.com/prefix/chat/completions");
  expect(new Headers(init.headers).get("authorization")).toBe(
    "Bearer PERSONAL",
  );
  expect(JSON.parse(init.body)).toMatchObject({
    model: "personal-text",
    max_completion_tokens: expect.any(Number),
  });
  transport.fetch.mockImplementation(async () =>
    Response.json({ error: { message: "SECRET" } }, { status: 500 }),
  );
  transport.fetch.mockClear();
  await expect(client.inferFromText("hello", {})).rejects.toMatchObject({
    code: "UNKNOWN",
  });
  expect(transport.fetch).toHaveBeenCalledOnce();
});

it("isolates two personal clients and snapshots settings", async () => {
  const mutable = { ...settings };
  const first = createUserAIInferenceClient(mutable, "FIRST", []);
  mutable.baseUrl = "https://evil.example";
  mutable.textModel = "changed";
  const second = createUserAIInferenceClient(
    { ...settings, baseUrl: "https://second.example/v2", textModel: "second" },
    "SECOND",
    [],
  );
  await first.inferFromText("hello", {});
  await second.inferFromText("hello", {});
  expect(String(transport.fetch.mock.calls[0][0])).toContain(
    "example.com/prefix/",
  );
  expect(JSON.parse(transport.fetch.mock.calls[0][1].body).model).toBe(
    "personal-text",
  );
  expect(
    new Headers(transport.fetch.mock.calls[1][1].headers).get("authorization"),
  ).toBe("Bearer SECOND");
});

it("rejects disabled, unconfigured and missing-key settings without network calls", () => {
  expect(() =>
    createUserAIInferenceClient({ ...settings, enabled: false }, "KEY", []),
  ).toThrow("NOT_ENABLED");
  expect(() =>
    createUserAIInferenceClient({ ...settings, textModel: "" }, "KEY", []),
  ).toThrow("UNCONFIGURED");
  expect(() => createUserAIInferenceClient(settings, null, [])).toThrow(
    "KEY_REQUIRED",
  );
  expect(transport.fetch).not.toHaveBeenCalled();
});

it("forbids embeddings and an unconfigured image model", async () => {
  const client = createUserAIInferenceClient(
    { ...settings, imageModel: null },
    "KEY",
    [],
  );
  await expect(
    client.generateEmbeddingFromText(["hello"]),
  ).rejects.toBeDefined();
  await expect(
    client.inferFromImage("hello", "image/png", "base64", {}),
  ).rejects.toMatchObject({ code: "UNCONFIGURED" });
  expect(transport.fetch).not.toHaveBeenCalled();
});

it("uses the personal vision model", async () => {
  await createUserAIInferenceClient(settings, "KEY", []).inferFromImage(
    "hello",
    "image/png",
    "base64",
    {},
  );
  expect(JSON.parse(transport.fetch.mock.calls[0][1].body).model).toBe(
    "personal-vision",
  );
});

it("sanitizes network construction and SDK errors", async () => {
  transport.create.mockImplementationOnce(() => {
    throw new UserAINetworkError("ADDRESS_BLOCKED");
  });
  expect(() => createUserAIInferenceClient(settings, "KEY", [])).toThrow(
    "ADDRESS_BLOCKED",
  );
  transport.fetch.mockImplementation(async () =>
    Response.json(
      { error: { message: "SECRET https://sensitive" } },
      { status: 401 },
    ),
  );
  const error = await createUserAIInferenceClient(settings, "KEY", [])
    .inferFromText("hello", {})
    .catch((error: unknown) => error);
  expect(error).toMatchObject({ code: "AUTH_FAILED" });
  expect(String(error)).not.toMatch(/SECRET|sensitive/);
  expect(error).not.toHaveProperty("cause");
});

it.each([undefined, "OLLAMA-KEY"])(
  "supports Ollama optional key %s and native path prefix",
  async (key) => {
    transport.fetch.mockImplementation(
      async () =>
        new Response('{"response":"ok","done":true,"eval_count":2}\n'),
    );
    const client = createUserAIInferenceClient(
      { ...settings, provider: "ollama" },
      key,
      [],
    );
    expect(await client.inferFromText("hello", {})).toMatchObject({
      response: "ok",
      totalTokens: 2,
    });
    const [url, init] = transport.fetch.mock.calls[0];
    expect(new URL(String(url)).href).toBe(
      "https://example.com/prefix/api/generate",
    );
    expect(new Headers(init.headers).get("authorization")).toBe(
      key ? `Bearer ${key}` : null,
    );
  },
);

it("sanitizes strict Ollama stream failures without logging or partial success", async () => {
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
  transport.fetch.mockImplementation(
    async () => new Response('{"response":"partial"}\n{"error":"SECRET"}\n'),
  );
  const error = await createUserAIInferenceClient(
    { ...settings, provider: "ollama" },
    null,
    [],
  )
    .inferFromText("hello", {})
    .catch((error: unknown) => error);
  expect(error).toMatchObject({ code: "INVALID_RESPONSE" });
  expect(String(error)).not.toContain("SECRET");
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

it.each([
  '{"response":"partial","done":false}\nAuthorization: SECRET https://sensitive\n{"response":"","done":true}\n',
  '{"response":"partial","done":true}\nAuthorization: SECRET https://sensitive\n',
  '{"response":"partial","done":true}\n{"response":"extra","done":true}\n',
])(
  "rejects malformed Ollama JSON without any output or partial success: %s",
  async (body) => {
    const spies = [
      ...(["warn", "error", "log", "info", "debug"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      ),
      ...(["warn", "error", "info", "debug"] as const).map((method) =>
        vi.spyOn(logger, method).mockImplementation(() => logger),
      ),
    ];
    try {
      transport.fetch.mockImplementation(async () => new Response(body));
      const result = await createUserAIInferenceClient(
        { ...settings, provider: "ollama" },
        null,
        [],
      )
        .inferFromText("hello", {})
        .catch((error: unknown) => error);
      expect(result).toMatchObject({ code: "INVALID_RESPONSE" });
      expect(String(result)).not.toMatch(/SECRET|sensitive|partial/);
      expect(result).not.toHaveProperty("response");
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  },
);

it("passes caller cancellation through Ollama transport", async () => {
  const controller = new AbortController();
  transport.fetch.mockImplementation(async (_url, init) => {
    expect(init.signal.aborted).toBe(true);
    throw new UserAINetworkError("CONNECTION_FAILED");
  });
  controller.abort("SECRET");
  await expect(
    createUserAIInferenceClient(
      { ...settings, provider: "ollama" },
      null,
      [],
    ).inferFromText("hello", { abortSignal: controller.signal }),
  ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
});

it("does not inherit global OpenAI organization, project or debug logging", async () => {
  vi.stubEnv("OPENAI_ORG_ID", "GLOBAL-ORG");
  vi.stubEnv("OPENAI_PROJECT_ID", "GLOBAL-PROJECT");
  vi.stubEnv("OPENAI_LOG", "debug");
  const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
  try {
    await createUserAIInferenceClient(settings, "PERSONAL", []).inferFromText(
      "hello",
      {},
    );
    const headers = new Headers(transport.fetch.mock.calls[0][1].headers);
    expect(headers.has("openai-organization")).toBe(false);
    expect(headers.has("openai-project")).toBe(false);
    expect(debug).not.toHaveBeenCalled();
  } finally {
    debug.mockRestore();
    vi.unstubAllEnvs();
  }
});

it("maps Ollama HTTP auth failures and rejects empty results", async () => {
  transport.fetch.mockImplementation(async () =>
    Response.json({ error: "SECRET" }, { status: 401 }),
  );
  const client = createUserAIInferenceClient(
    { ...settings, provider: "ollama" },
    null,
    [],
  );
  await expect(client.inferFromText("hello", {})).rejects.toMatchObject({
    code: "AUTH_FAILED",
  });
  transport.fetch.mockImplementation(
    async () => new Response('{"response":"","done":true}\n'),
  );
  await expect(client.inferFromText("hello", {})).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});

it.each([
  {
    message: "model does not support image input SECRET",
    expected: "UNSUPPORTED_IMAGE",
  },
  { code: "vision_not_supported", expected: "UNSUPPORTED_IMAGE" },
  { param: "response_format", expected: "OUTPUT_FORMAT_UNSUPPORTED" },
])(
  "preserves non-enumerable Ollama error metadata: $expected",
  async ({ expected, ...fields }) => {
    const upstream = new Error("SECRET");
    Object.defineProperty(upstream, "status_code", { value: 400 });
    for (const [field, value] of Object.entries(fields)) {
      Object.defineProperty(upstream, field, { value, configurable: true });
    }
    transport.fetch.mockRejectedValue(upstream);
    const result = await createUserAIInferenceClient(
      { ...settings, provider: "ollama" },
      null,
      [],
    )
      .inferFromImage("hello", "image/png", "base64", {})
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code: expected });
    expect(String(result)).not.toContain("SECRET");
    expect(result).not.toHaveProperty("cause");
  },
);
