import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  UserAIProfiles,
  discoverUserAIModels,
  testUserAIConnection,
  sanitizeUserAIError,
} from "@karakeep/shared-server";
import serverConfig from "@karakeep/shared/config";
import {
  zUserAIDraft,
  zUserAISave,
  zUserAIProfile,
  zUserAIModelsResult,
  zUserAITestResult,
} from "@karakeep/shared/types/userAI";
import type { UserAIModel } from "@karakeep/shared/types/userAI";
import { createScopedAuthedProcedure, router } from "../index";

const procedure = createScopedAuthedProcedure("users");
const requests = new Map<string, { start: number; count: number }>();
const modelCache = new Map<
  string,
  { expires: number; result: Promise<UserAIModel[]> }
>();

function limit(userId: string, action: string, maximum: number) {
  const now = Date.now();
  for (const [key, value] of requests)
    if (now - value.start >= 60_000) requests.delete(key);
  const key = `${userId}:${action}`;
  const entry = requests.get(key) ?? { start: now, count: 0 };
  if (entry.count >= maximum)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Wait before trying AI configuration again.",
    });
  if (requests.size >= 10_000 && !requests.has(key))
    throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
  entry.count++;
  requests.set(key, entry);
}

function safe<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    const sanitized = sanitizeUserAIError(error);
    throw new TRPCError({
      code: sanitized.code === "CONFLICT" ? "CONFLICT" : "BAD_REQUEST",
      message: sanitized.message,
    });
  }
}

export const userAIRouter = router({
  get: procedure
    .output(zUserAIProfile)
    .query(({ ctx }) => new UserAIProfiles(ctx.db).get(ctx.user.id)),
  save: procedure
    .input(zUserAISave)
    .output(zUserAIProfile)
    .mutation(({ ctx, input }) => {
      limit(ctx.user.id, "write", 20);
      return safe(() => new UserAIProfiles(ctx.db).save(ctx.user.id, input));
    }),
  clearKey: procedure
    .input(z.object({ revision: z.number().int().nonnegative() }))
    .output(zUserAIProfile)
    .mutation(({ ctx, input }) => {
      limit(ctx.user.id, "write", 20);
      return safe(() =>
        new UserAIProfiles(ctx.db).clearKey(ctx.user.id, input.revision),
      );
    }),
  models: procedure
    .input(zUserAIDraft)
    .output(zUserAIModelsResult)
    .mutation(async ({ ctx, input }) => {
      limit(ctx.user.id, "models", 10);
      try {
        const { settings, apiKey, fingerprint } = new UserAIProfiles(
          ctx.db,
        ).resolveDraft(ctx.user.id, input);
        const now = Date.now();
        for (const [key, value] of modelCache)
          if (value.expires <= now) modelCache.delete(key);
        let cached = modelCache.get(fingerprint);
        if (!cached) {
          if (modelCache.size >= 200)
            modelCache.delete(modelCache.keys().next().value!);
          const result = discoverUserAIModels(
            settings,
            apiKey,
            serverConfig.userAI.allowedPrivateOrigins,
          );
          cached = { expires: now + 300_000, result };
          modelCache.set(fingerprint, cached);
          void result.catch(() => modelCache.delete(fingerprint));
        }
        return { models: await cached.result, errorCode: null, fingerprint };
      } catch (error) {
        return {
          models: [],
          errorCode: sanitizeUserAIError(error).code,
          fingerprint: null,
        };
      }
    }),
  test: procedure
    .input(zUserAIDraft.extend({ kind: z.enum(["text", "vision"]) }))
    .output(zUserAITestResult)
    .mutation(async ({ ctx, input }) => {
      limit(ctx.user.id, "test", 5);
      const start = Date.now();
      try {
        const { settings, apiKey, fingerprint } = new UserAIProfiles(
          ctx.db,
        ).resolveDraft(ctx.user.id, input);
        const result = await testUserAIConnection(
          settings,
          apiKey,
          input.kind,
          serverConfig.userAI.allowedPrivateOrigins,
        );
        return {
          ...result,
          kind: input.kind,
          fingerprint,
          latencyMs: Date.now() - start,
        };
      } catch (error) {
        return {
          kind: input.kind,
          status: "unverified" as const,
          errorCode: sanitizeUserAIError(error).code,
          fingerprint: null,
          latencyMs: Date.now() - start,
        };
      }
    }),
});
