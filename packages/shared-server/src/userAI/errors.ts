import type { UserAIErrorCode } from "@karakeep/shared/types/userAI";

const messages: Record<UserAIErrorCode, string> = {
  NOT_ENABLED: "Personal AI is disabled.",
  UNCONFIGURED: "Configure your personal AI connection first.",
  ENCRYPTION_KEY_MISSING:
    "The server AI encryption key is not configured correctly.",
  DECRYPTION_FAILED:
    "The saved AI key cannot be decrypted. Re-enter it or restore the server encryption key.",
  CONFLICT: "AI settings changed. Reload before saving.",
  KEY_REQUIRED: "Enter an API key for this connection.",
  KEY_REENTRY_REQUIRED:
    "Re-enter your API key after changing the connection address or provider.",
  INVALID_URL:
    "Enter a valid HTTP or HTTPS base URL without credentials, query or fragment.",
  ADDRESS_BLOCKED:
    "This destination is not allowed by the server network policy.",
  AUTH_FAILED: "The AI service rejected the credentials.",
  MODEL_UNAVAILABLE: "The selected model or endpoint is unavailable.",
  RATE_LIMITED: "The AI service is rate limited.",
  QUOTA_EXCEEDED: "The AI service reports insufficient quota.",
  UNSUPPORTED_IMAGE:
    "The service explicitly rejected image input for this model.",
  INVALID_RESPONSE: "The model response could not be verified.",
  OUTPUT_FORMAT_UNSUPPORTED: "The selected output format is not supported.",
  TIMEOUT: "The AI request timed out.",
  CONNECTION_FAILED: "Unable to reach the AI service.",
  RESPONSE_TOO_LARGE: "The AI response exceeded the server limit.",
  REDIRECT_BLOCKED: "AI service redirects are not allowed.",
  UNKNOWN: "The AI request failed. Check the connection and model settings.",
};

export class UserAIError extends Error {
  constructor(readonly code: UserAIErrorCode) {
    super(`${code}: ${messages[code]}`);
    this.name = "UserAIError";
  }
}

export function sanitizeUserAIError(error: unknown, depth = 0): UserAIError {
  if (error instanceof UserAIError) return error;
  if (!error || typeof error !== "object") return new UserAIError("UNKNOWN");
  const value = error as {
    code?: unknown;
    status?: unknown;
    param?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  if (
    typeof value.code === "string" &&
    [
      "INVALID_URL",
      "ADDRESS_BLOCKED",
      "TIMEOUT",
      "CONNECTION_FAILED",
      "RESPONSE_TOO_LARGE",
      "REDIRECT_BLOCKED",
    ].includes(value.code)
  ) {
    return new UserAIError(value.code as UserAIErrorCode);
  }
  if (depth < 5 && value.cause && value.cause !== error) {
    const cause = sanitizeUserAIError(value.cause, depth + 1);
    if (cause.code !== "UNKNOWN") return cause;
  }
  if (value.status === 401 || value.status === 403)
    return new UserAIError("AUTH_FAILED");
  if (value.code === "insufficient_quota")
    return new UserAIError("QUOTA_EXCEEDED");
  if (value.status === 429) return new UserAIError("RATE_LIMITED");
  if (value.status === 404) return new UserAIError("MODEL_UNAVAILABLE");
  if (value.status === 400 || value.status === 422) {
    if (
      [
        "unsupported_image",
        "vision_not_supported",
        "image_not_supported",
      ].includes(String(value.code)) ||
      (typeof value.message === "string" &&
        /(?:model.{0,60}(?:does not support|doesn't support).{0,30}(?:image|vision)|image input.{0,20}(?:is not supported|unsupported))/i.test(
          value.message,
        ))
    )
      return new UserAIError("UNSUPPORTED_IMAGE");
    if (
      value.param === "response_format" ||
      value.code === "unsupported_response_format"
    )
      return new UserAIError("OUTPUT_FORMAT_UNSUPPORTED");
  }
  if (
    value.code === "ETIMEDOUT" ||
    (error instanceof Error &&
      ["AbortError", "TimeoutError", "APIConnectionTimeoutError"].includes(
        error.name,
      ))
  )
    return new UserAIError("TIMEOUT");
  return new UserAIError("UNKNOWN");
}
