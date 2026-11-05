import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  apiKeys,
  captureEvents,
  pushDeliveries,
  pushDevices,
} from "@karakeep/db/schema";
import { CaptureEvents, FcmTransport } from "@karakeep/shared-server";
import {
  zCaptureEvent,
  zEventCursor,
  zPushRegistration,
} from "@karakeep/shared/types/captureEvents";

import { createScopedAuthedProcedure, router } from "../index";
import { createRateLimitMiddleware } from "../lib/rateLimit";

const captureProcedure = createScopedAuthedProcedure("bookmarks");
const devicesProcedure = createScopedAuthedProcedure("users");

export const captureRouter = router({
  recent: captureProcedure
    .output(z.array(zCaptureEvent))
    .query(({ ctx }) => new CaptureEvents(ctx.db).recent(ctx.user.id)),
  events: captureProcedure
    .input(zEventCursor)
    .output(
      z.object({
        items: z.array(zCaptureEvent),
        nextCursor: z.number(),
        hasMore: z.boolean(),
      }),
    )
    .query(({ ctx, input }) =>
      new CaptureEvents(ctx.db).events(ctx.user.id, input.cursor, input.limit),
    ),
  status: captureProcedure
    .input(z.object({ bookmarkId: z.string() }))
    .query(({ ctx, input }) =>
      new CaptureEvents(ctx.db).status(ctx.user.id, input.bookmarkId),
    ),
  pushStatus: devicesProcedure.query(async ({ ctx }) => ({
    configured: new FcmTransport().configured,
    devices: await ctx.db
      .select({
        id: pushDevices.id,
        scope: pushDevices.scope,
        enabled: pushDevices.enabled,
        modifiedAt: pushDevices.modifiedAt,
      })
      .from(pushDevices)
      .where(eq(pushDevices.userId, ctx.user.id)),
  })),
  registerDevice: devicesProcedure
    .input(zPushRegistration)
    .use(
      createRateLimitMiddleware({
        name: "push.register",
        windowMs: 60000,
        maxRequests: 20,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!new FcmTransport().configured)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "FCM is not configured on this server",
        });
      const apiKey =
        ctx.auth?.type === "apiKey"
          ? await ctx.db.query.apiKeys.findFirst({
              where: and(
                eq(apiKeys.keyId, ctx.auth.keyId),
                eq(apiKeys.userId, ctx.user.id),
              ),
            })
          : null;
      if (ctx.auth?.type === "apiKey" && !apiKey)
        throw new TRPCError({ code: "UNAUTHORIZED" });
      try {
        return ctx.db.transaction((tx) => {
          const same = tx
            .select()
            .from(pushDevices)
            .where(
              and(
                eq(pushDevices.userId, ctx.user.id),
                eq(pushDevices.scope, input.scope),
                eq(pushDevices.token, input.token),
              ),
            )
            .get();
          if (same) {
            tx.update(pushDevices)
              .set({
                enabled: true,
                modifiedAt: new Date(),
                apiKeyId: apiKey?.id ?? null,
              })
              .where(eq(pushDevices.id, same.id))
              .run();
            return { id: same.id };
          }
          // A native token follows the installation, not the previous account.
          tx.delete(pushDevices)
            .where(eq(pushDevices.token, input.token))
            .run();
          tx.delete(pushDevices)
            .where(
              and(
                eq(pushDevices.userId, ctx.user.id),
                eq(pushDevices.scope, input.scope),
              ),
            )
            .run();
          if (
            tx
              .select()
              .from(pushDevices)
              .where(eq(pushDevices.userId, ctx.user.id))
              .all().length >= 10
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Remove an old push device before registering another",
            });
          const id = randomUUID();
          const now = new Date();
          tx.insert(pushDevices)
            .values({
              id,
              userId: ctx.user.id,
              token: input.token,
              scope: input.scope,
              apiKeyId: apiKey?.id ?? null,
              enabled: true,
              createdAt: now,
              modifiedAt: now,
            })
            .run();
          return { id };
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to register push device",
        });
      }
    }),
  unregisterDevice: devicesProcedure
    .input(z.object({ scope: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pushDevices)
        .where(
          and(
            eq(pushDevices.userId, ctx.user.id),
            eq(pushDevices.scope, input.scope),
          ),
        );
      return { success: true };
    }),
  testPush: devicesProcedure
    .input(z.object({ scope: z.string().min(1).max(200) }))
    .use(
      createRateLimitMiddleware({
        name: "push.test",
        windowMs: 60000,
        maxRequests: 1,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!new FcmTransport().configured)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "FCM is not configured on this server",
        });
      return ctx.db.transaction((tx) => {
        const device = tx
          .select()
          .from(pushDevices)
          .where(
            and(
              eq(pushDevices.userId, ctx.user.id),
              eq(pushDevices.scope, input.scope),
              eq(pushDevices.enabled, true),
            ),
          )
          .get();
        if (!device)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Enable push notifications on this device first",
          });
        const now = new Date();
        const event = tx
          .insert(captureEvents)
          .values({
            eventKey: `test:${randomUUID()}`,
            userId: ctx.user.id,
            type: "push.test",
            platform: "system",
            message: "This is a Karakeep test notification.",
            retryable: false,
            createdAt: now,
          })
          .returning()
          .get();
        tx.insert(pushDeliveries)
          .values({
            id: `${event.id}:${device.id}`,
            deviceId: device.id,
            eventId: event.id,
            availableAt: now,
          })
          .run();
        return { eventId: event.id };
      });
    }),
  deliveries: devicesProcedure
    .input(z.object({ eventId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: pushDeliveries.id,
          state: pushDeliveries.state,
          attempts: pushDeliveries.attempts,
          lastError: pushDeliveries.lastError,
        })
        .from(pushDeliveries)
        .innerJoin(captureEvents, eq(pushDeliveries.eventId, captureEvents.id))
        .where(
          and(
            eq(captureEvents.userId, ctx.user.id),
            eq(captureEvents.id, input.eventId),
          ),
        );
    }),
});
