import { z } from "zod";

export const zResolverIdSchema = z.enum(["xiaohongshu", "douyin", "wechat"]);

export const zResolverSecretKeySchema = z.enum([
  "xhsCookie",
  "douyinCookie",
  "wechatArticleAuthKey",
]);

export const zResolverRuntimeSettingSchema = z.object({
  resolverId: zResolverIdSchema,
  key: zResolverSecretKeySchema,
  configured: z.boolean(),
  source: z.enum(["runtime", "environment", "unset"]),
  modifiedAt: z.date().nullable(),
});

export const zResolverRuntimeSettingsSchema = z.object({
  xiaohongshu: z.object({
    xhsCookie: zResolverRuntimeSettingSchema,
  }),
  douyin: z.object({
    douyinCookie: zResolverRuntimeSettingSchema,
  }),
  wechat: z.object({
    wechatArticleAuthKey: zResolverRuntimeSettingSchema,
  }),
});

export const zUpdateResolverRuntimeSecretSchema = z.object({
  resolverId: zResolverIdSchema,
  key: zResolverSecretKeySchema,
  value: z.string().min(1).max(20000),
});

export const zClearResolverRuntimeSecretSchema = z.object({
  resolverId: zResolverIdSchema,
  key: zResolverSecretKeySchema,
});

export type ResolverId = z.infer<typeof zResolverIdSchema>;
export type ResolverSecretKey = z.infer<typeof zResolverSecretKeySchema>;
export type ResolverRuntimeSetting = z.infer<
  typeof zResolverRuntimeSettingSchema
>;
export type ResolverRuntimeSettings = z.infer<
  typeof zResolverRuntimeSettingsSchema
>;
