import {
  zClearResolverRuntimeSecretSchema,
  zResolverRuntimeSettingsSchema,
  zUpdateResolverRuntimeSecretSchema,
} from "@karakeep/shared/types/resolverSettings";

import { createAdminScopedProcedure, router } from "../index";
import { ResolverSettings } from "../models/resolverSettings";
import { CookieCloud } from "@karakeep/shared-server";
import { zCookieCloudSettings } from "@karakeep/shared/types/cookiecloud";

const adminSystemProcedure = createAdminScopedProcedure("system");

export const resolverSettingsRouter = router({
  cookieCloudStatus: adminSystemProcedure.query(({ ctx }) =>
    new CookieCloud(ctx.db).status(),
  ),
  saveCookieCloud: adminSystemProcedure
    .input(zCookieCloudSettings)
    .mutation(({ ctx, input }) => new CookieCloud(ctx.db).save(input)),
  syncCookieCloud: adminSystemProcedure.mutation(({ ctx }) =>
    new CookieCloud(ctx.db).sync(),
  ),
  status: adminSystemProcedure
    .output(zResolverRuntimeSettingsSchema)
    .query(async ({ ctx }) => {
      return await new ResolverSettings(ctx).getStatus();
    }),

  update: adminSystemProcedure
    .input(zUpdateResolverRuntimeSecretSchema)
    .mutation(async ({ ctx, input }) => {
      await new ResolverSettings(ctx).update(input);
      return await new ResolverSettings(ctx).getStatus();
    }),

  clear: adminSystemProcedure
    .input(zClearResolverRuntimeSecretSchema)
    .mutation(async ({ ctx, input }) => {
      await new ResolverSettings(ctx).clear(input);
      return await new ResolverSettings(ctx).getStatus();
    }),
});
