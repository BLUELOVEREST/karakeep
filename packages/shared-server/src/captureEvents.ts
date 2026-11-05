import { and, desc, eq, gt, sql } from "drizzle-orm";

import type { DB } from "@karakeep/db";
import {
  bookmarkLinks,
  bookmarks,
  captureEvents,
  captureStates,
  config,
  pushDevices,
  pushDeliveries,
} from "@karakeep/db/schema";
import type { ZCrawlError } from "@karakeep/shared/types/bookmarks";
import { captureErrorMessage } from "@karakeep/shared/types/captureErrorMessages";

export function capturePlatform(url: string) {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "web";
  }
  for (const [platform, domains] of Object.entries({
    xiaohongshu: ["xiaohongshu.com", "xhslink.com", "xhslink.cn"],
    douyin: ["douyin.com", "iesdouyin.com"],
    wechat: ["mp.weixin.qq.com"],
    coolapk: ["coolapk.com", "coolapk1.com"],
    smzdm: ["smzdm.com"],
  })) {
    if (
      domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
    )
      return platform;
  }
  return "web";
}

export class CaptureEvents {
  constructor(private readonly db: DB) {}

  private eventQuery() {
    return this.db
      .select({
        event: captureEvents,
        title: sql<
          string | null
        >`coalesce(${bookmarks.title}, ${bookmarkLinks.title})`,
      })
      .from(captureEvents)
      .leftJoin(bookmarks, eq(captureEvents.bookmarkId, bookmarks.id))
      .leftJoin(bookmarkLinks, eq(captureEvents.bookmarkId, bookmarkLinks.id));
  }

  started(bookmarkId: string, attemptId: string) {
    return this.db.transaction(() => {
      if (
        !this.db
          .select({ id: bookmarks.id })
          .from(bookmarks)
          .where(eq(bookmarks.id, bookmarkId))
          .get()
      )
        return;
      const now = new Date();
      this.db
        .delete(config)
        .where(eq(config.key, `capture-media:${bookmarkId}`))
        .run();
      this.db
        .insert(captureStates)
        .values({
          bookmarkId,
          attemptId,
          phase: "running",
          unresolved: false,
          startedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: captureStates.bookmarkId,
          set: { attemptId, phase: "running", startedAt: now, updatedAt: now },
        })
        .run();
    });
  }

  retrying(bookmarkId: string, attemptId: string) {
    this.db
      .update(captureStates)
      .set({ phase: "retrying", updatedAt: new Date() })
      .where(
        and(
          eq(captureStates.bookmarkId, bookmarkId),
          eq(captureStates.attemptId, attemptId),
        ),
      )
      .run();
  }

  finished(
    bookmarkId: string,
    attemptId: string,
    error: ZCrawlError | null,
    partial = false,
  ) {
    this.db.transaction((tx) => {
      const state = tx
        .select()
        .from(captureStates)
        .where(eq(captureStates.bookmarkId, bookmarkId))
        .get();
      if (
        !state ||
        state.attemptId !== attemptId ||
        !["running", "retrying", "awaiting_media"].includes(state.phase)
      )
        return;
      const mediaRow = tx
        .select()
        .from(config)
        .where(eq(config.key, `capture-media:${bookmarkId}`))
        .get();
      const media = mediaRow
        ? (JSON.parse(mediaRow.value) as {
            attemptId: string;
            status: string;
            error: ZCrawlError | null;
          })
        : null;
      if (media?.attemptId === attemptId && (!error || partial)) {
        if (media.status === "pending") {
          tx.update(captureStates)
            .set({
              phase: "awaiting_media",
              errorCode: error?.code ?? null,
              source: error?.source ?? null,
              retryable: error?.retryable ?? null,
              updatedAt: new Date(),
            })
            .where(eq(captureStates.bookmarkId, bookmarkId))
            .run();
          return;
        }
        if (!error && media.error) {
          error = media.error;
          partial = true;
        }
      }
      tx.delete(config)
        .where(eq(config.key, `capture-media:${bookmarkId}`))
        .run();
      const bookmark = tx
        .select({ userId: bookmarks.userId, url: bookmarkLinks.url })
        .from(bookmarks)
        .leftJoin(bookmarkLinks, eq(bookmarks.id, bookmarkLinks.id))
        .where(eq(bookmarks.id, bookmarkId))
        .get();
      if (!bookmark) return;
      const phase = error
        ? partial
          ? "partial"
          : "failed"
        : state.unresolved
          ? "recovered"
          : "success";
      const now = new Date();
      tx.update(captureStates)
        .set({
          phase,
          unresolved: !!error,
          errorCode: error?.code ?? null,
          source: error?.source ?? null,
          retryable: error?.retryable ?? null,
          updatedAt: now,
        })
        .where(eq(captureStates.bookmarkId, bookmarkId))
        .run();
      if (phase === "success") return;
      const event = tx
        .insert(captureEvents)
        .values({
          eventKey: `${bookmarkId}:${attemptId}:${phase}`,
          userId: bookmark.userId,
          bookmarkId,
          type:
            phase === "failed"
              ? "capture.failed"
              : phase === "partial"
                ? "capture.partial"
                : "capture.recovered",
          platform: capturePlatform(bookmark.url ?? ""),
          code: error?.code ?? null,
          message: error
            ? captureErrorMessage(error.code)
            : "Capture has recovered and all tracked resources were saved.",
          retryable: error?.retryable ?? false,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning()
        .get();
      if (!event) return;
      const devices = tx
        .select()
        .from(pushDevices)
        .where(
          and(
            eq(pushDevices.userId, bookmark.userId),
            eq(pushDevices.enabled, true),
          ),
        )
        .all();
      const auth =
        event.type === "capture.failed" &&
        ["AUTH_REQUIRED", "COOKIE_EXPIRED"].includes(event.code ?? "");
      const availableAt = new Date(
        auth
          ? (Math.floor(now.getTime() / 120000) + 1) * 120000 + 5000
          : now.getTime() + 5000,
      );
      for (const device of devices)
        tx.insert(pushDeliveries)
          .values({
            id: `${event.id}:${device.id}`,
            eventId: event.id,
            deviceId: device.id,
            availableAt,
          })
          .onConflictDoNothing()
          .run();
    });
  }

  status(userId: string, bookmarkId: string) {
    return (
      this.db
        .select({
          phase: captureStates.phase,
          code: captureStates.errorCode,
          source: captureStates.source,
          retryable: captureStates.retryable,
          startedAt: captureStates.startedAt,
          updatedAt: captureStates.updatedAt,
        })
        .from(captureStates)
        .innerJoin(bookmarks, eq(captureStates.bookmarkId, bookmarks.id))
        .where(and(eq(bookmarks.userId, userId), eq(bookmarks.id, bookmarkId)))
        .get() ?? null
    );
  }

  mediaStarted(bookmarkId: string, attemptId: string) {
    return this.db.transaction(() => {
      const state = this.db
        .select()
        .from(captureStates)
        .where(eq(captureStates.bookmarkId, bookmarkId))
        .get();
      if (state?.attemptId !== attemptId) return;
      const value = JSON.stringify({
        attemptId,
        status: "pending",
        error: null,
      });
      this.db
        .insert(config)
        .values({ key: `capture-media:${bookmarkId}`, value })
        .onConflictDoUpdate({ target: config.key, set: { value } })
        .run();
    });
  }

  mediaFinished(
    bookmarkId: string,
    attemptId: string,
    error: ZCrawlError | null,
  ) {
    return this.db.transaction(() => {
      const state = this.db
        .select()
        .from(captureStates)
        .where(eq(captureStates.bookmarkId, bookmarkId))
        .get();
      if (
        state?.attemptId !== attemptId ||
        !["running", "awaiting_media"].includes(state.phase)
      )
        return;
      const value = JSON.stringify({
        attemptId,
        status: "finished",
        error: error
          ? {
              code: error.code,
              source: error.source,
              retryable: error.retryable,
              message: captureErrorMessage(error.code),
            }
          : null,
      });
      this.db
        .update(config)
        .set({ value })
        .where(eq(config.key, `capture-media:${bookmarkId}`))
        .run();
      if (state.phase === "awaiting_media") {
        const original = state.errorCode
          ? {
              code: state.errorCode as ZCrawlError["code"],
              source: state.source as ZCrawlError["source"],
              retryable: state.retryable ?? false,
              message: "Capture error",
            }
          : null;
        this.finished(bookmarkId, attemptId, original, !!original);
      }
    });
  }

  events(userId: string, cursor = 0, limit = 50) {
    const rows = this.eventQuery()
      .where(
        and(eq(captureEvents.userId, userId), gt(captureEvents.id, cursor)),
      )
      .orderBy(captureEvents.id)
      .limit(limit + 1)
      .all();
    const items = rows
      .slice(0, limit)
      .map(
        ({ event: { eventKey: _key, userId: _owner, ...event }, title }) => ({
          ...event,
          title,
        }),
      );
    return {
      items,
      nextCursor: items.at(-1)?.id ?? cursor,
      hasMore: rows.length > limit,
    };
  }

  recent(userId: string) {
    return this.eventQuery()
      .where(eq(captureEvents.userId, userId))
      .orderBy(desc(captureEvents.id))
      .limit(50)
      .all()
      .map(
        ({ event: { eventKey: _key, userId: _owner, ...event }, title }) => ({
          ...event,
          title,
        }),
      );
  }
}
