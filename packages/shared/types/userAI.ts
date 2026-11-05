import { z } from "zod";

export const zUserAIProvider = z.enum(["openai", "ollama"]);
export const zUserAIErrorCode = z.enum([
  "NOT_ENABLED",
  "UNCONFIGURED",
  "ENCRYPTION_KEY_MISSING",
  "DECRYPTION_FAILED",
  "CONFLICT",
  "KEY_REQUIRED",
  "KEY_REENTRY_REQUIRED",
  "INVALID_URL",
  "ADDRESS_BLOCKED",
  "AUTH_FAILED",
  "MODEL_UNAVAILABLE",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "UNSUPPORTED_IMAGE",
  "INVALID_RESPONSE",
  "OUTPUT_FORMAT_UNSUPPORTED",
  "TIMEOUT",
  "CONNECTION_FAILED",
  "RESPONSE_TOO_LARGE",
  "REDIRECT_BLOCKED",
  "UNKNOWN",
]);
export type UserAIErrorCode = z.infer<typeof zUserAIErrorCode>;

export const zUserAISettings = z.object({
  enabled: z.boolean(),
  provider: zUserAIProvider,
  baseUrl: z.string().trim().min(1).max(2048),
  textModel: z.string().trim().max(256),
  imageModel: z.string().trim().min(1).max(256).nullable(),
  outputSchema: z.enum(["structured", "json", "plain"]),
  useMaxCompletionTokens: z.boolean(),
});
export const zUserAIDraft = zUserAISettings.extend({
  apiKey: z.string().trim().max(4096).optional(),
  revision: z.number().int().nonnegative().optional(),
});
export const zUserAISave = zUserAIDraft
  .extend({ revision: z.number().int().nonnegative() })
  .refine((value) => !value.enabled || !!value.textModel, {
    message: "Select a text model before enabling AI",
    path: ["textModel"],
  });
export const zUserAIProfile = zUserAISettings.extend({
  baseUrl: z.string(),
  revision: z.number().int().nonnegative(),
  keyConfigured: z.boolean(),
  encryptionAvailable: z.boolean(),
  updatedAt: z.date().nullable(),
});
export const zUserAIModel = z.object({
  id: z.string().min(1).max(256),
  group: z.string().nullable(),
});
export const zUserAIModelsResult = z.object({
  models: z.array(zUserAIModel),
  errorCode: zUserAIErrorCode.nullable(),
  fingerprint: z.string().nullable(),
});
export const zUserAITestResult = z.object({
  kind: z.enum(["text", "vision"]),
  status: z.enum(["passed", "unsupported", "unverified"]),
  errorCode: zUserAIErrorCode.nullable(),
  fingerprint: z.string().nullable(),
  latencyMs: z.number().nonnegative(),
});
export type UserAISettings = z.infer<typeof zUserAISettings>;
export type UserAIDraft = z.infer<typeof zUserAIDraft>;
export type UserAIProfile = z.infer<typeof zUserAIProfile>;
export type UserAIModel = z.infer<typeof zUserAIModel>;

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});
const compareIds = (a: string, b: string) =>
  collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

export function sortUserAIModels(ids: string[]): UserAIModel[] {
  return [...new Set(ids)]
    .filter(
      (id) =>
        id.length > 0 &&
        id.length <= 256 &&
        id === id.trim() &&
        ![...id].some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ),
    )
    .map((id) => ({
      id,
      group:
        id.indexOf("/") > 0 ? id.slice(0, id.indexOf("/")).toLowerCase() : null,
    }))
    .sort((a, b) =>
      a.group === b.group
        ? compareIds(a.id, b.id)
        : a.group === null
          ? 1
          : b.group === null
            ? -1
            : compareIds(a.group, b.group),
    );
}
