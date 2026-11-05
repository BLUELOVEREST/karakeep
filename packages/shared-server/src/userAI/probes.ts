import { randomInt } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";

import type {
  UserAIErrorCode,
  UserAIModel,
  UserAISettings,
} from "@karakeep/shared/types/userAI";
import { sortUserAIModels } from "@karakeep/shared/types/userAI";
import {
  createUserAIFetch,
  normalizeUserAIBaseUrl,
} from "@karakeep/shared/userAINetwork";

import { sanitizeUserAIError, UserAIError } from "./errors";

const timeoutMs = 15_000;
const maxResponseBytes = 1024 * 1024;
const modelId = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (id) =>
      id === id.trim() &&
      ![...id].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ),
  );
const textAnswer = z.object({ ok: z.literal(true) }).strict();
const visionAnswer = z
  .object({ colors: z.array(z.string()).length(4) })
  .strict();

function connection(
  settings: UserAISettings,
  apiKey: string | null,
  allowedPrivateOrigins: string[],
) {
  if (settings.provider === "openai" && !apiKey?.trim())
    throw new UserAIError("KEY_REQUIRED");
  const baseUrl = normalizeUserAIBaseUrl(settings.baseUrl);
  const headers: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};
  return {
    baseUrl,
    headers,
    fetch: createUserAIFetch(baseUrl, {
      allowedPrivateOrigins,
      timeoutMs,
      maxResponseBytes,
    }),
  };
}

async function readResponse(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw new UserAIError("INVALID_RESPONSE");
  }
  if (!response.ok) {
    const envelope =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const error =
      envelope.error && typeof envelope.error === "object"
        ? (envelope.error as Record<string, unknown>)
        : {};
    // Never retain or return the upstream object or its free-form message.
    throw sanitizeUserAIError({
      status: response.status,
      code: error.code,
      param: error.param,
      message:
        typeof envelope.error === "string" ? envelope.error : error.message,
    });
  }
  return body;
}

export async function discoverUserAIModels(
  settings: UserAISettings,
  apiKey: string | null,
  allowedPrivateOrigins: string[],
): Promise<UserAIModel[]> {
  try {
    const conn = connection(settings, apiKey, allowedPrivateOrigins);
    const body = await readResponse(
      await conn.fetch(
        `${conn.baseUrl}${settings.provider === "openai" ? "/models" : "/api/tags"}`,
        { method: "GET", headers: conn.headers },
      ),
    );
    const result =
      settings.provider === "openai"
        ? z
            .object({ data: z.array(z.object({ id: modelId })).max(1000) })
            .safeParse(body)
        : z
            .object({ models: z.array(z.object({ name: modelId })).max(1000) })
            .safeParse(body);
    if (!result.success) throw new UserAIError("INVALID_RESPONSE");
    const ids =
      "data" in result.data
        ? result.data.data.map((model) => model.id)
        : result.data.models.map((model) => model.name);
    return sortUserAIModels(ids);
  } catch (error) {
    throw sanitizeUserAIError(error);
  }
}

async function visionChallenge() {
  const palette = [
    { label: "red", rgb: [255, 0, 0] },
    { label: "green", rgb: [0, 255, 0] },
    { label: "blue", rgb: [0, 0, 255] },
    { label: "yellow", rgb: [255, 255, 0] },
    { label: "magenta", rgb: [255, 0, 255] },
    { label: "cyan", rgb: [0, 255, 255] },
  ];
  for (let i = palette.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [palette[i], palette[j]] = [palette[j], palette[i]];
  }
  const selected = palette.slice(0, 4);
  const width = 256;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      selected[Math.floor(x / 64)].rgb.forEach((channel, i) => {
        pixels[offset + i] = channel;
      });
    }
  }
  const png = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  return {
    image: png.toString("base64"),
    labels: selected.map((color) => color.label),
    prompt:
      'Identify the four solid color panels in the attached image from left to right. Return only JSON with a "colors" array of four lowercase English color names. Use red, green, blue, yellow, magenta or cyan. Do not describe your capabilities.',
  };
}

export async function testUserAIConnection(
  settings: UserAISettings,
  apiKey: string | null,
  kind: "text" | "vision",
  allowedPrivateOrigins: string[],
): Promise<{
  status: "passed" | "unsupported" | "unverified";
  errorCode: UserAIErrorCode | null;
}> {
  try {
    const model = kind === "vision" ? settings.imageModel : settings.textModel;
    if (!model?.trim()) throw new UserAIError("UNCONFIGURED");
    const conn = connection(settings, apiKey, allowedPrivateOrigins);
    const challenge = kind === "vision" ? await visionChallenge() : null;
    const prompt =
      challenge?.prompt ?? 'Return only this JSON object: {"ok":true}';
    const schema = z.toJSONSchema(
      kind === "vision" ? visionAnswer : textAnswer,
    );
    // Direct guarded requests enforce probe-specific caps without global-client defaults or retries.
    const body =
      settings.provider === "openai"
        ? {
            model,
            stream: false,
            ...(settings.useMaxCompletionTokens
              ? { max_completion_tokens: 128 }
              : { max_tokens: 128 }),
            ...(settings.outputSchema === "structured"
              ? {
                  response_format: {
                    type: "json_schema",
                    json_schema: {
                      name: "connection_test",
                      strict: true,
                      schema,
                    },
                  },
                }
              : settings.outputSchema === "json"
                ? { response_format: { type: "json_object" } }
                : {}),
            messages: [
              {
                role: "user",
                content: challenge
                  ? [
                      { type: "text", text: prompt },
                      {
                        type: "image_url",
                        image_url: {
                          url: `data:image/png;base64,${challenge.image}`,
                          detail: "low",
                        },
                      },
                    ]
                  : prompt,
              },
            ],
          }
        : {
            model,
            prompt,
            stream: false,
            options: { num_predict: 128 },
            ...(challenge ? { images: [challenge.image] } : {}),
            ...(settings.outputSchema === "structured"
              ? { format: schema }
              : settings.outputSchema === "json"
                ? { format: "json" }
                : {}),
          };
    const response = await readResponse(
      await conn.fetch(
        `${conn.baseUrl}${settings.provider === "openai" ? "/chat/completions" : "/api/generate"}`,
        {
          method: "POST",
          headers: { ...conn.headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    );
    const parsed =
      settings.provider === "openai"
        ? z
            .object({
              choices: z
                .array(z.object({ message: z.object({ content: z.string() }) }))
                .min(1),
            })
            .safeParse(response)
        : z.object({ response: z.string() }).safeParse(response);
    if (!parsed.success) throw new UserAIError("INVALID_RESPONSE");
    const content =
      "choices" in parsed.data
        ? parsed.data.choices[0].message.content
        : parsed.data.response;
    let answer: unknown;
    try {
      answer = JSON.parse(content);
    } catch {
      throw new UserAIError("INVALID_RESPONSE");
    }
    if (challenge) {
      const result = visionAnswer.safeParse(answer);
      if (
        !result.success ||
        !result.data.colors.every((color, i) => color === challenge.labels[i])
      ) {
        throw new UserAIError("INVALID_RESPONSE");
      }
    } else if (!textAnswer.safeParse(answer).success) {
      throw new UserAIError("INVALID_RESPONSE");
    }
    return { status: "passed", errorCode: null };
  } catch (error) {
    const { code } = sanitizeUserAIError(error);
    return {
      status:
        kind === "vision" && code === "UNSUPPORTED_IMAGE"
          ? "unsupported"
          : "unverified",
      errorCode: code,
    };
  }
}
