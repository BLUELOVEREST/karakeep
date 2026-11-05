import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserAISettings } from "@karakeep/shared/types/userAI";
import { createUserAIFetch } from "@karakeep/shared/userAINetwork";

import { discoverUserAIModels, testUserAIConnection } from "./probes";

vi.mock("@karakeep/shared/userAINetwork", async (original) => ({
  ...(await original<typeof import("@karakeep/shared/userAINetwork")>()),
  createUserAIFetch: vi.fn(),
}));

const request = vi.fn<typeof fetch>();
const settings: UserAISettings = {
  enabled: false,
  provider: "openai",
  baseUrl: "https://example.com/proxy/v1/",
  textModel: "text-model",
  imageModel: "vision-model",
  outputSchema: "json",
  useMaxCompletionTokens: false,
};
const origins = ["http://localhost:11434"];
const completion = (content: string) =>
  Response.json({ choices: [{ message: { content } }] });

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createUserAIFetch).mockReturnValue(request);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected network request");
    }),
  );
});

describe("model discovery", () => {
  it.each(["openai", "ollama"] as const)(
    "accepts 1000 entries but rejects 1001 before deduplication for %s",
    async (provider) => {
      const entry = provider === "openai" ? { id: "model" } : { name: "model" };
      const field = provider === "openai" ? "data" : "models";
      request.mockResolvedValue(
        Response.json({ [field]: Array(1000).fill(entry) }),
      );
      expect(
        await discoverUserAIModels({ ...settings, provider }, "key", []),
      ).toEqual([{ id: "model", group: null }]);
      request.mockResolvedValue(
        Response.json({ [field]: Array(1001).fill(entry) }),
      );
      await expect(
        discoverUserAIModels({ ...settings, provider }, "key", []),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    },
  );
  it.each([{}, { models: [{}] }, { models: [{ name: "bad\nmodel" }] }])(
    "rejects malformed Ollama lists: %j",
    async (body) => {
      request.mockResolvedValue(Response.json(body));
      await expect(
        discoverUserAIModels({ ...settings, provider: "ollama" }, null, []),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    },
  );
  it("preserves prefixes, authenticates and sorts exact unique OpenAI IDs", async () => {
    request.mockResolvedValue(
      Response.json({
        data: [
          { id: "gpt-10" },
          { id: "a/model" },
          { id: "gpt-2" },
          { id: "gpt-2" },
        ],
      }),
    );
    expect(
      (await discoverUserAIModels(settings, "secret", origins)).map(
        (m) => m.id,
      ),
    ).toEqual(["a/model", "gpt-2", "gpt-10"]);
    expect(request).toHaveBeenCalledWith(
      "https://example.com/proxy/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      }),
    );
    expect(createUserAIFetch).toHaveBeenCalledWith(
      "https://example.com/proxy/v1",
      expect.objectContaining({
        allowedPrivateOrigins: origins,
        timeoutMs: 15000,
        maxResponseBytes: expect.any(Number),
      }),
    );
  });

  it.each([null, "key"])(
    "uses native Ollama tags with optional auth: %s",
    async (key) => {
      request.mockResolvedValue(
        Response.json({ models: [{ name: "llama:latest" }] }),
      );
      expect(
        await discoverUserAIModels(
          { ...settings, provider: "ollama" },
          key,
          [],
        ),
      ).toEqual([{ id: "llama:latest", group: null }]);
      expect(request).toHaveBeenCalledWith(
        "https://example.com/proxy/v1/api/tags",
        expect.objectContaining({
          headers: key ? { Authorization: `Bearer ${key}` } : {},
        }),
      );
    },
  );

  it.each([
    {},
    { data: null },
    { data: [{}] },
    { data: [{ id: 1 }] },
    { data: [{ id: " padded " }] },
    { data: [{ id: "" }] },
  ])("rejects malformed lists: %j", async (body) => {
    request.mockResolvedValue(Response.json(body));
    await expect(
      discoverUserAIModels(settings, "key", []),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("allows empty lists and rejects missing keys before requests", async () => {
    await expect(
      discoverUserAIModels(settings, null, []),
    ).rejects.toMatchObject({ code: "KEY_REQUIRED" });
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValue(Response.json({ data: [] }));
    expect(await discoverUserAIModels(settings, "key", [])).toEqual([]);
  });

  it("sanitizes upstream HTTP errors and invalid JSON", async () => {
    request.mockResolvedValue(new Response("secret upstream", { status: 401 }));
    await expect(
      discoverUserAIModels(settings, "secret", []),
    ).rejects.toMatchObject({ code: "AUTH_FAILED" });
    request.mockResolvedValue(new Response("secret non-json"));
    await expect(
      discoverUserAIModels(settings, "key", []),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("real inference probes", () => {
  it.each(["openai", "ollama"] as const)(
    "parses actual structured %s model answers rather than trusting successful HTTP",
    async (provider) => {
      for (const answer of [
        '{"ok":true}',
        '{"ok":false}',
        '{"ok":"true"}',
        '{"ok":true,"extra":1}',
        "not-json",
      ]) {
        request.mockResolvedValue(
          provider === "openai"
            ? completion(answer)
            : Response.json({ response: answer }),
        );
        expect(
          await testUserAIConnection(
            { ...settings, provider, outputSchema: "structured" },
            "key",
            "text",
            [],
          ),
        ).toEqual(
          answer === '{"ok":true}'
            ? { status: "passed", errorCode: null }
            : { status: "unverified", errorCode: "INVALID_RESPONSE" },
        );
        const body = JSON.parse(request.mock.calls.at(-1)![1]!.body as string);
        const schema =
          provider === "openai"
            ? body.response_format.json_schema.schema
            : body.format;
        expect(schema).toMatchObject({
          type: "object",
          required: ["ok"],
          additionalProperties: false,
          properties: { ok: { type: "boolean", const: true } },
        });
      }
    },
  );
  it("sends a PNG to native Ollama and rejects incorrect ordered labels", async () => {
    request.mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      expect(body.model).toBe("vision-model");
      expect(body.options.num_predict).toBe(128);
      expect(body.stream).toBe(false);
      expect(body.format).toBe("json");
      expect(
        await sharp(Buffer.from(body.images[0], "base64")).metadata(),
      ).toMatchObject({ format: "png", width: 256, height: 64 });
      return Response.json({
        response: JSON.stringify({ colors: ["red", "red", "red", "red"] }),
      });
    });
    expect(
      await testUserAIConnection(
        { ...settings, provider: "ollama" },
        null,
        "vision",
        [],
      ),
    ).toEqual({ status: "unverified", errorCode: "INVALID_RESPONSE" });
  });

  it("does not return raw unexpected exceptions or accept malformed completions", async () => {
    request.mockRejectedValue(new Error("secret URL key response"));
    expect(await testUserAIConnection(settings, "key", "text", [])).toEqual({
      status: "unverified",
      errorCode: "UNKNOWN",
    });
    request.mockResolvedValue(Response.json({ choices: [] }));
    expect(await testUserAIConnection(settings, "key", "text", [])).toEqual({
      status: "unverified",
      errorCode: "INVALID_RESPONSE",
    });
  });
  it.each(["structured", "json", "plain"] as const)(
    "checks text JSON using %s output mode with bounded tokens",
    async (outputSchema) => {
      request.mockResolvedValue(completion('{"ok":true}'));
      expect(
        await testUserAIConnection(
          { ...settings, outputSchema, useMaxCompletionTokens: true },
          "key",
          "text",
          origins,
        ),
      ).toEqual({ status: "passed", errorCode: null });
      const body = JSON.parse(request.mock.calls[0][1]!.body as string);
      expect(body.model).toBe("text-model");
      expect(body.max_completion_tokens).toBe(128);
      expect(body.max_tokens).toBeUndefined();
      expect(body.response_format?.type).toBe(
        outputSchema === "structured"
          ? "json_schema"
          : outputSchema === "json"
            ? "json_object"
            : undefined,
      );
      expect(body.messages[0].content).toContain('"ok":true');
    },
  );

  it.each(["yes", '{"ok":false}', '{"ok":"true"}'])(
    "does not accept invalid text answers: %s",
    async (answer) => {
      request.mockResolvedValue(completion(answer));
      expect(await testUserAIConnection(settings, "key", "text", [])).toEqual({
        status: "unverified",
        errorCode: "INVALID_RESPONSE",
      });
    },
  );

  it("validates random unique PNG colors in image order without revealing the answer", async () => {
    const signatures = new Set<string>();
    request.mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      expect(body.model).toBe("vision-model");
      expect(body.max_tokens).toBe(128);
      const content = body.messages[0].content;
      const data = content[1].image_url.url.split(",")[1];
      const { data: pixels, info } = await sharp(Buffer.from(data, "base64"))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const palette: Record<string, string> = {
        "255,0,0": "red",
        "0,255,0": "green",
        "0,0,255": "blue",
        "255,255,0": "yellow",
        "255,0,255": "magenta",
        "0,255,255": "cyan",
      };
      const labels = Array.from({ length: 4 }, (_, i) => {
        const offset =
          (Math.floor(info.height / 2) * info.width +
            Math.floor(((i + 0.5) * info.width) / 4)) *
          info.channels;
        return palette[[...pixels.subarray(offset, offset + 3)].join(",")];
      });
      expect(labels.every(Boolean)).toBe(true);
      expect(new Set(labels).size).toBe(4);
      expect(content[0].text).not.toContain(JSON.stringify(labels));
      signatures.add(labels.join(","));
      return completion(JSON.stringify({ colors: labels }));
    });
    for (let i = 0; i < 8; i++)
      expect(await testUserAIConnection(settings, "key", "vision", [])).toEqual(
        { status: "passed", errorCode: null },
      );
    expect(signatures.size).toBeGreaterThan(1);
  });

  it("does not equate wrong answers or self-declarations with vision support", async () => {
    request.mockResolvedValue(completion('{"supportsImages":true}'));
    expect(await testUserAIConnection(settings, "key", "vision", [])).toEqual({
      status: "unverified",
      errorCode: "INVALID_RESPONSE",
    });
  });

  it.each([
    [400, { code: "unsupported_image" }, "unsupported", "UNSUPPORTED_IMAGE"],
    [401, { message: "secret" }, "unverified", "AUTH_FAILED"],
    [429, {}, "unverified", "RATE_LIMITED"],
    [
      400,
      { param: "response_format" },
      "unverified",
      "OUTPUT_FORMAT_UNSUPPORTED",
    ],
  ])("sanitizes HTTP %s errors", async (status, error, result, code) => {
    request.mockResolvedValue(
      Response.json({ error }, { status: status as number }),
    );
    expect(await testUserAIConnection(settings, "key", "vision", [])).toEqual({
      status: result,
      errorCode: code,
    });
  });

  it.each([
    "TIMEOUT",
    "ADDRESS_BLOCKED",
    "RESPONSE_TOO_LARGE",
    "REDIRECT_BLOCKED",
  ])("does not classify %s as unsupported vision", async (code) => {
    request.mockRejectedValue({ code, message: "secret" });
    expect(await testUserAIConnection(settings, "key", "vision", [])).toEqual({
      status: "unverified",
      errorCode: code,
    });
  });

  it("uses bounded native Ollama inference and verifies the actual response", async () => {
    request.mockResolvedValue(Response.json({ response: '{"ok":true}' }));
    expect(
      await testUserAIConnection(
        { ...settings, provider: "ollama", outputSchema: "structured" },
        null,
        "text",
        [],
      ),
    ).toEqual({ status: "passed", errorCode: null });
    expect(request.mock.calls[0][0]).toBe(
      "https://example.com/proxy/v1/api/generate",
    );
    expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toMatchObject({
      model: "text-model",
      stream: false,
      options: { num_predict: 128 },
      format: { type: "object" },
    });
  });

  it("requires a selected model without falling back to another model", async () => {
    expect(
      await testUserAIConnection(
        { ...settings, imageModel: null },
        "key",
        "vision",
        [],
      ),
    ).toEqual({ status: "unverified", errorCode: "UNCONFIGURED" });
    expect(request).not.toHaveBeenCalled();
  });
});
