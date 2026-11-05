import { z } from "zod";

export const COOKIECLOUD_SCHEDULES = {
  hourly: "0 * * * *",
  sixHours: "0 */6 * * *",
  twelveHours: "0 */12 * * *",
  daily: "0 0 * * *",
} as const;

export const zCookieCloudSettings = z.object({
  enabled: z.boolean(),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }, "Use an HTTP(S) base URL without credentials, query or fragment"),
  uuid: z.string().trim().max(200),
  password: z.string().min(1).max(2000).optional(),
  cron: z.string().trim().max(100),
  timezone: z
    .string()
    .trim()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return !!value;
      } catch {
        return false;
      }
    }, "Invalid timezone"),
});

export type CookieCloudSettings = z.infer<typeof zCookieCloudSettings>;
export type CookieCloudPlatform = "xiaohongshu" | "douyin";
export interface CookieCloudResult {
  attemptedAt: string;
  platforms: Record<
    CookieCloudPlatform,
    "updated" | "missing" | "failed" | "unavailable"
  >;
  error: string | null;
}
