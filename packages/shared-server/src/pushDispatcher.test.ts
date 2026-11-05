import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import type { DB } from "@karakeep/db";
import { getInMemoryDB } from "@karakeep/db/drizzle";
import {
  bookmarks,
  bookmarkLinks,
  captureEvents,
  pushDeliveries,
  pushDevices,
  users,
} from "@karakeep/db/schema";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import { CaptureEvents } from "./captureEvents";
import { PushDeliveryError } from "./fcm";
import type { NotificationTransport } from "./fcm";
import { PushDispatcher } from "./pushDispatcher";

let db: DB;
const send = vi.fn<NotificationTransport["send"]>(async () => undefined);
beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue(undefined);
  db = getInMemoryDB(true);
  db.insert(users)
    .values({ id: "owner", name: "Owner", email: "owner@test.com" })
    .run();
  db.insert(bookmarks)
    .values({ id: "bookmark", userId: "owner", type: BookmarkTypes.LINK })
    .run();
  db.insert(bookmarkLinks)
    .values({ id: "bookmark", url: "https://www.coolapk.com/feed/example" })
    .run();
  db.insert(pushDevices)
    .values({
      id: "phone",
      userId: "owner",
      token: "private-token",
      scope: "login-scope",
      createdAt: new Date(),
      modifiedAt: new Date(),
    })
    .run();
});
function fail() {
  const captures = new CaptureEvents(db);
  captures.started("bookmark", "attempt");
  captures.finished("bookmark", "attempt", {
    code: "UNKNOWN",
    source: "unknown",
    message: "raw secret",
    retryable: false,
  });
}
const due = () => new Date(Date.now() + 10000);
afterEach(() => vi.useRealTimers());

function queueSecondEvent() {
  db.insert(bookmarks)
    .values({
      id: "second-bookmark",
      userId: "owner",
      type: BookmarkTypes.LINK,
    })
    .run();
  const event = db
    .insert(captureEvents)
    .values({
      eventKey: "second",
      userId: "owner",
      bookmarkId: "second-bookmark",
      type: "capture.failed",
      platform: "web",
      code: "UNKNOWN",
      message: "Safe message",
      retryable: false,
      createdAt: new Date(),
    })
    .returning()
    .get();
  db.insert(pushDeliveries)
    .values({
      id: "second-delivery",
      deviceId: "phone",
      eventId: event.id,
      availableAt: new Date(Date.now() + 7000),
    })
    .run();
}

describe("push outbox", () => {
  it("stops other sends in the batch after a token is revoked", async () => {
    fail();
    queueSecondEvent();
    send.mockRejectedValue(
      new PushDeliveryError("FCM_TOKEN_REVOKED", false, true),
    );
    await new PushDispatcher(db, {
      channel: "fcm",
      configured: true,
      send,
    }).tick(due());
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rechecks due time after another operation reschedules a cached delivery", async () => {
    fail();
    queueSecondEvent();
    send.mockImplementationOnce(async () => {
      db.update(pushDeliveries)
        .set({ availableAt: new Date(Date.now() + 3600000) })
        .where(eq(pushDeliveries.id, "second-delivery"))
        .run();
    });
    await new PushDispatcher(db, {
      channel: "fcm",
      configured: true,
      send,
    }).tick(due());
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("uses fresh time for leases and failure backoff in a long batch", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    fail();
    queueSecondEvent();
    let observedLease = 0;
    send.mockImplementationOnce(async () => {
      vi.setSystemTime(start + 100000);
    });
    send.mockImplementationOnce(async () => {
      observedLease = db
        .select()
        .from(pushDeliveries)
        .all()
        .find((row) => row.id === "second-delivery")!
        .leaseUntil!.getTime();
      throw new PushDeliveryError("TEMPORARY", true);
    });
    await new PushDispatcher(db, {
      channel: "fcm",
      configured: true,
      send,
    }).tick(new Date(start + 10000));
    expect(observedLease).toBeGreaterThan(Date.now());
    expect(
      db
        .select()
        .from(pushDeliveries)
        .all()
        .find((row) => row.id === "second-delivery")!
        .availableAt.getTime(),
    ).toBeGreaterThan(Date.now());
  });
  it("does not consume events when FCM is unconfigured", async () => {
    fail();
    await new PushDispatcher(db, {
      channel: "fcm",
      configured: false,
      send,
    }).tick(due());
    expect(send).not.toHaveBeenCalled();
    expect(db.select().from(pushDeliveries).all()[0].state).toBe("pending");
  });
  it("sends sanitized payloads once and binds navigation to the login scope", async () => {
    fail();
    const dispatcher = new PushDispatcher(db, {
      channel: "fcm",
      configured: true,
      send,
    });
    await dispatcher.tick(due());
    await dispatcher.tick(due());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      data: { scope: "login-scope", bookmarkId: "bookmark" },
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain("raw secret");
    expect(db.select().from(pushDeliveries).all()[0].state).toBe("sent");
  });
  it("backs off transient failures without losing the capture event", async () => {
    fail();
    send.mockRejectedValue(
      new PushDeliveryError("FCM_TEMPORARILY_UNAVAILABLE", true),
    );
    await new PushDispatcher(db, {
      channel: "fcm",
      configured: true,
      send,
    }).tick(due());
    expect(db.select().from(pushDeliveries).all()[0]).toMatchObject({
      state: "pending",
      attempts: 1,
    });
    expect(db.select().from(captureEvents).all()).toHaveLength(1);
  });
  it("revokes invalid devices and skips pending notifications after logout", async () => {
    fail();
    send.mockRejectedValue(
      new PushDeliveryError("FCM_TOKEN_REVOKED", false, true),
    );
    await new PushDispatcher(db, {
      channel: "fcm",
      configured: true,
      send,
    }).tick(due());
    expect(db.select().from(pushDevices).all()[0].enabled).toBe(false);
    expect(db.select().from(pushDeliveries).all()[0].state).toBe("failed");
  });
  it("combines authentication failures in the same two-minute window", async () => {
    const now = new Date();
    for (let id = 1; id <= 3; id++) {
      const bookmarkId = `auth-bookmark-${id}`;
      db.insert(bookmarks)
        .values({ id: bookmarkId, userId: "owner", type: BookmarkTypes.LINK })
        .run();
      const event = db
        .insert(captureEvents)
        .values({
          eventKey: `auth-${id}`,
          userId: "owner",
          bookmarkId,
          type: "capture.failed",
          platform: "xiaohongshu",
          code: "COOKIE_EXPIRED",
          message: "Cookie expired",
          retryable: false,
          createdAt: now,
        })
        .returning()
        .get();
      db.insert(pushDeliveries)
        .values({
          id: String(id),
          deviceId: "phone",
          eventId: event.id,
          availableAt: now,
        })
        .run();
    }
    await new PushDispatcher(db, {
      channel: "fcm",
      configured: true,
      send,
    }).tick(now);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      data: { count: "3", bookmarkId: "" },
    });
  });
  it("does not send an outdated failure after the bookmark has recovered", async () => {
    fail();
    const capture = new CaptureEvents(db);
    capture.started("bookmark", "retry");
    capture.finished("bookmark", "retry", null);
    await new PushDispatcher(db, {
      channel: "fcm",
      configured: true,
      send,
    }).tick(due());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].data.type).toBe("capture.recovered");
  });
  it("recovers an expired delivery lease", async () => {
    fail();
    db.update(pushDeliveries)
      .set({
        state: "sending",
        leaseId: "crashed-worker",
        leaseUntil: new Date(0),
        attempts: 1,
      })
      .run();
    await new PushDispatcher(db, {
      channel: "fcm",
      configured: true,
      send,
    }).tick(due());
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.select().from(pushDeliveries).all()[0]).toMatchObject({
      state: "sent",
      attempts: 2,
    });
  });
  it("stops after five transient attempts", async () => {
    fail();
    send.mockRejectedValue(new PushDeliveryError("TEMPORARY", true));
    const dispatcher = new PushDispatcher(db, {
      channel: "fcm",
      configured: true,
      send,
    });
    for (let attempt = 0; attempt < 6; attempt++)
      await dispatcher.tick(new Date(due().getTime() + attempt * 3600000));
    expect(send).toHaveBeenCalledTimes(5);
    expect(db.select().from(pushDeliveries).all()[0]).toMatchObject({
      state: "failed",
      attempts: 5,
    });
  });
});
