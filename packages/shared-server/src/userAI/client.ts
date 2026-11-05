import {
  InvalidInferenceResponseError,
  OllamaInferenceClient,
  OpenAIInferenceClient,
} from "@karakeep/shared/inference";
import type {
  InferenceClient,
  InferenceOptions,
  InferenceResponse,
} from "@karakeep/shared/inference";
import { zUserAISettings } from "@karakeep/shared/types/userAI";
import type { UserAISettings } from "@karakeep/shared/types/userAI";
import {
  createUserAIFetch,
  normalizeUserAIBaseUrl,
} from "@karakeep/shared/userAINetwork";

import { sanitizeUserAIError, UserAIError } from "./errors";

export function createUserAIInferenceClient(
  settings: UserAISettings,
  apiKey: string | null | undefined,
  allowedPrivateOrigins: string[] = [],
): InferenceClient {
  try {
    const parsed = zUserAISettings.safeParse(settings);
    if (!parsed.success) throw new UserAIError("UNCONFIGURED");
    const config = parsed.data;
    if (!config.enabled) throw new UserAIError("NOT_ENABLED");
    if (!config.textModel) throw new UserAIError("UNCONFIGURED");
    const key = apiKey?.trim();
    if (config.provider === "openai" && !key)
      throw new UserAIError("KEY_REQUIRED");
    const baseUrl = normalizeUserAIBaseUrl(config.baseUrl);
    const restrictedFetch = createUserAIFetch(baseUrl, {
      allowedPrivateOrigins: [...allowedPrivateOrigins],
      timeoutMs: 30_000,
      maxResponseBytes: 8 * 1024 * 1024,
    });

    // Per-call clients keep Ollama's abort-all API isolated from other calls.
    const buildClient = (abortSignal?: AbortSignal): InferenceClient => {
      const fetch: typeof globalThis.fetch = (input, init) => {
        const headers = new Headers(
          init?.headers ??
            (input instanceof Request ? input.headers : undefined),
        );
        if (config.provider === "ollama" && key)
          headers.set("Authorization", `Bearer ${key}`);
        const sdkSignal =
          init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const signals = [sdkSignal, abortSignal].filter(
          (signal): signal is AbortSignal => !!signal,
        );
        return restrictedFetch(input, {
          ...init,
          headers,
          signal: signals.length ? AbortSignal.any(signals) : undefined,
        });
      };
      const common = {
        fetch,
        textModel: config.textModel,
        imageModel: config.imageModel ?? "",
        contextLength: 8192,
        maxOutputTokens: 2048,
        outputSchema: config.outputSchema,
      };
      if (config.provider === "openai") {
        const client = new OpenAIInferenceClient({
          ...common,
          apiKey: key!,
          baseURL: baseUrl,
          timeoutSec: 30,
          maxRetries: 0,
          useMaxCompletionTokens: config.useMaxCompletionTokens,
        });
        client.openAI.organization = null;
        client.openAI.project = null;
        client.openAI.logLevel = "off";
        return client;
      }
      return new OllamaInferenceClient({
        ...common,
        baseUrl,
        strictErrors: true,
      });
    };

    const run = async (
      opts: Partial<InferenceOptions>,
      operation: (client: InferenceClient) => Promise<InferenceResponse>,
    ): Promise<InferenceResponse> => {
      try {
        const result = await operation(buildClient(opts.abortSignal));
        if (!result.response?.trim()) throw new UserAIError("INVALID_RESPONSE");
        return result;
      } catch (error) {
        if (error instanceof InvalidInferenceResponseError)
          throw new UserAIError("INVALID_RESPONSE");
        // Ollama uses status_code rather than the OpenAI SDK's status field.
        if (error && typeof error === "object" && "status_code" in error) {
          throw sanitizeUserAIError({
            status: error.status_code,
            message: "message" in error ? error.message : undefined,
            code: "code" in error ? error.code : undefined,
            param: "param" in error ? error.param : undefined,
          });
        }
        throw sanitizeUserAIError(error);
      }
    };

    return {
      inferFromText: (prompt, opts) =>
        run(opts, (client) => client.inferFromText(prompt, opts)),
      inferFromImage: async (prompt, contentType, image, opts) => {
        if (!config.imageModel) throw new UserAIError("UNCONFIGURED");
        return run(opts, (client) =>
          client.inferFromImage(prompt, contentType, image, opts),
        );
      },
      generateEmbeddingFromText: async () => {
        throw new UserAIError("MODEL_UNAVAILABLE");
      },
    };
  } catch (error) {
    throw sanitizeUserAIError(error);
  }
}
