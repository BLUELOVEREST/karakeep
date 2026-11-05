import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, lt, lte, or, sql } from "drizzle-orm";

import type { DB } from "@karakeep/db";
import {
  captureEvents,
  pushDeliveries,
  pushDevices,
} from "@karakeep/db/schema";

import { PushDeliveryError } from "./fcm";
import type { NotificationTransport } from "./fcm";

export class PushDispatcher {
  private stopped = false;
  constructor(
    private readonly db: DB,
    private readonly transport: NotificationTransport,
  ) {}
  stop() {
    this.stopped = true;
  }

  async tick(now = new Date()) {
    if (this.stopped || !this.transport.configured) return;
    const startedAt = Date.now();
    const currentTime = () => new Date(now.getTime() + Date.now() - startedAt);
    const eligibleAt = (at: Date) =>
      or(
        eq(pushDeliveries.state, "pending"),
        and(
          eq(pushDeliveries.state, "sending"),
          lte(pushDeliveries.leaseUntil, at),
        ),
      );
    const rows = this.db
      .select({
        delivery: pushDeliveries,
        event: captureEvents,
        device: pushDevices,
      })
      .from(pushDeliveries)
      .innerJoin(captureEvents, eq(pushDeliveries.eventId, captureEvents.id))
      .innerJoin(pushDevices, eq(pushDeliveries.deviceId, pushDevices.id))
      .where(and(eligibleAt(now), lte(pushDeliveries.availableAt, now)))
      .orderBy(pushDeliveries.availableAt)
      .limit(500)
      .all();
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const superseded =
        row.event.bookmarkId &&
        this.db
          .select({ id: captureEvents.id })
          .from(captureEvents)
          .where(
            and(
              eq(captureEvents.bookmarkId, row.event.bookmarkId),
              gt(captureEvents.id, row.event.id),
            ),
          )
          .limit(1)
          .get();
      if (superseded || row.delivery.attempts >= 5) {
        this.db
          .update(pushDeliveries)
          .set({
            state: "skipped",
            lastError: superseded ? "SUPERSEDED_EVENT" : "RETRY_LIMIT_REACHED",
          })
          .where(
            and(
              eq(pushDeliveries.id, row.delivery.id),
              eligibleAt(currentTime()),
            ),
          )
          .run();
        continue;
      }
      if (
        row.event.createdAt.getTime() < now.getTime() - 86400000 ||
        (!row.event.bookmarkId && row.event.type !== "push.test")
      ) {
        this.db
          .update(pushDeliveries)
          .set({ state: "skipped", lastError: "STALE_OR_REVOKED" })
          .where(
            and(
              eq(pushDeliveries.id, row.delivery.id),
              eligibleAt(currentTime()),
            ),
          )
          .run();
        continue;
      }
      const auth =
        row.event.type === "capture.failed" &&
        ["COOKIE_EXPIRED", "AUTH_REQUIRED"].includes(row.event.code ?? "");
      const group = auth
        ? `${row.device.id}:${row.event.platform}:auth:${Math.floor(row.event.createdAt.getTime() / 120000)}`
        : row.delivery.id;
      groups.set(group, [...(groups.get(group) ?? []), row]);
    }
    for (const [group, batch] of groups) {
      if (this.stopped) break;
      const leaseId = randomUUID();
      const claim = this.db.transaction((tx) => {
        const at = currentTime();
        const fresh = tx
          .select({
            delivery: pushDeliveries,
            event: captureEvents,
            device: pushDevices,
          })
          .from(pushDeliveries)
          .innerJoin(
            captureEvents,
            eq(pushDeliveries.eventId, captureEvents.id),
          )
          .innerJoin(pushDevices, eq(pushDeliveries.deviceId, pushDevices.id))
          .where(
            and(
              inArray(
                pushDeliveries.id,
                batch.map((row) => row.delivery.id),
              ),
              eligibleAt(at),
              lte(pushDeliveries.availableAt, at),
              lt(pushDeliveries.attempts, 5),
            ),
          )
          .all();
        const valid = fresh.filter((row) => {
          const superseded =
            row.event.bookmarkId &&
            tx
              .select({ id: captureEvents.id })
              .from(captureEvents)
              .where(
                and(
                  eq(captureEvents.bookmarkId, row.event.bookmarkId),
                  gt(captureEvents.id, row.event.id),
                ),
              )
              .limit(1)
              .get();
          return (
            !superseded &&
            row.device.enabled &&
            row.device.userId === row.event.userId &&
            row.device.modifiedAt.getTime() >= at.getTime() - 30 * 86400000 &&
            row.event.createdAt.getTime() >= at.getTime() - 86400000 &&
            (row.event.bookmarkId || row.event.type === "push.test")
          );
        });
        const invalid = fresh.filter((row) => !valid.includes(row));
        if (invalid.length)
          tx.update(pushDeliveries)
            .set({ state: "skipped", lastError: "STALE_OR_REVOKED" })
            .where(
              inArray(
                pushDeliveries.id,
                invalid.map((row) => row.delivery.id),
              ),
            )
            .run();
        if (!valid.length) return null;
        const claimed = tx
          .update(pushDeliveries)
          .set({
            state: "sending",
            attempts: sql`${pushDeliveries.attempts} + 1`,
            leaseUntil: new Date(at.getTime() + 90000),
            leaseId,
          })
          .where(
            inArray(
              pushDeliveries.id,
              valid.map((row) => row.delivery.id),
            ),
          )
          .returning()
          .all();
        return { selected: valid, claimed };
      });
      if (!claim) continue;
      const { selected, claimed } = claim;
      const { event, device } = selected.at(-1)!;
      const count = new Set(
        selected.map((row) => row.event.bookmarkId ?? String(row.event.id)),
      ).size;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.transport.send({
            token: device.token,
            title:
              event.type === "capture.recovered"
                ? "Capture recovered"
                : event.type === "capture.partial"
                  ? "Capture partially completed"
                  : event.type === "push.test"
                    ? "Karakeep test notification"
                    : "Capture failed",
            body:
              count > 1
                ? `${count} ${event.platform} captures require authentication. Check the platform credentials.`
                : event.message,
            tag: group.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 160),
            data: {
              eventId: String(event.id),
              bookmarkId: count === 1 ? (event.bookmarkId ?? "") : "",
              scope: device.scope,
              count: String(count),
              type: event.type,
            },
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new PushDeliveryError("FCM_TIMEOUT", true)),
              20000,
            );
          }),
        ]);
        this.db
          .update(pushDeliveries)
          .set({
            state: "sent",
            leaseUntil: null,
            leaseId: null,
            lastError: null,
          })
          .where(eq(pushDeliveries.leaseId, leaseId))
          .run();
      } catch (error) {
        const failure =
          error instanceof PushDeliveryError
            ? error
            : new PushDeliveryError("PUSH_TRANSPORT_FAILED", true);
        if (failure.revokeDevice)
          this.db
            .update(pushDevices)
            .set({ enabled: false })
            .where(eq(pushDevices.id, device.id))
            .run();
        for (const delivery of claimed) {
          const attempts = delivery.attempts;
          this.db
            .update(pushDeliveries)
            .set({
              state: failure.retryable && attempts < 5 ? "pending" : "failed",
              attempts,
              leaseId: null,
              leaseUntil: null,
              lastError: failure.code,
              availableAt: new Date(
                currentTime().getTime() +
                  Math.min(3600000, 30000 * 2 ** (attempts - 1)),
              ),
            })
            .where(
              and(
                eq(pushDeliveries.id, delivery.id),
                eq(pushDeliveries.leaseId, leaseId),
              ),
            )
            .run();
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  }
}
