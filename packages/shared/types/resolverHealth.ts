import { z } from "zod";

export const zResolverHealth = z.object({
  id: z.enum(["xiaohongshu", "douyin", "wechat", "coolapk", "smzdm"]),
  status: z.enum(["not_configured", "connected", "error", "not_checked"]),
  checkedAt: z.date(),
  latencyMs: z.number().nonnegative().nullable(),
  errorCode: z
    .enum([
      "HTTP_ERROR",
      "INVALID_RESPONSE",
      "TIMEOUT",
      "CONNECTION_FAILED",
      "HEALTH_CHECK_UNSUPPORTED",
      "INVALID_CONFIGURATION",
    ])
    .nullable(),
  httpStatus: z.number().int().nullable(),
});

export type ZResolverHealth = z.infer<typeof zResolverHealth>;
