import {
  zClearResolverRuntimeSecretSchema,
  zResolverRuntimeSettingsSchema,
  zUpdateResolverRuntimeSecretSchema,
} from "@karakeep/shared/types/resolverSettings";

import { createAdminScopedProcedure, router } from "../index";
import { ResolverSettings } from "../models/resolverSettings";

const adminSystemProcedure = createAdminScopedProcedure("system");

export const resolverSettingsRouter = router({
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
