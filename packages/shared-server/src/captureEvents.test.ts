import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DB } from "@karakeep/db";
import * as schema from "@karakeep/db/schema";

import { CaptureEvents } from "./captureEvents";

let sqlite: InstanceType<typeof Database>;
let db: DB;
let service: CaptureEvents;
beforeEach(() => {
  sqlite = new Database(":memory:");
  // Only the columns needed by this unit are required; migrations have separate coverage.
  sqlite.exec(`CREATE TABLE bookmarks (id TEXT PRIMARY KEY, userId TEXT NOT NULL, title TEXT);
    CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE bookmarkLinks (id TEXT PRIMARY KEY, url TEXT, title TEXT);
    CREATE TABLE captureState (bookmarkId TEXT PRIMARY KEY, attemptId TEXT, phase TEXT NOT NULL, unresolved INTEGER NOT NULL, errorCode TEXT, source TEXT, retryable INTEGER, startedAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE TABLE captureEvent (id INTEGER PRIMARY KEY AUTOINCREMENT, eventKey TEXT NOT NULL UNIQUE, userId TEXT NOT NULL, bookmarkId TEXT, type TEXT NOT NULL, platform TEXT NOT NULL, code TEXT, message TEXT NOT NULL, retryable INTEGER NOT NULL, createdAt INTEGER NOT NULL);
    CREATE TABLE pushDevice (id TEXT PRIMARY KEY, userId TEXT, apiKeyId TEXT, token TEXT, scope TEXT, enabled INTEGER, createdAt INTEGER, modifiedAt INTEGER);
    CREATE TABLE pushDelivery (id TEXT PRIMARY KEY, eventId INTEGER, deviceId TEXT, state TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, availableAt INTEGER, leaseUntil INTEGER, leaseId TEXT, lastError TEXT);
    INSERT INTO bookmarks (id,userId) VALUES ('one','owner'); INSERT INTO bookmarkLinks (id,url) VALUES ('one','https://www.xiaohongshu.com/explore/example');`);
  db = drizzle(sqlite, { schema }) as DB;
  service = new CaptureEvents(db);
});
afterEach(() => sqlite.close());

describe("capture lifecycle", () => {
  it("does not notify ordinary success or intermediate retries", () => {
    service.started("one", "job:1");
    service.retrying("one", "job:1");
    expect(service.status("owner", "one")?.phase).toBe("retrying");
    service.finished("one", "job:1", null);
    expect(service.events("owner").items).toHaveLength(0);
  });
  it("records final failure once and never publishes raw error text", () => {
    service.started("one", "job:1");
    const error = {
      source: "link_resolver" as const,
      code: "COOKIE_EXPIRED" as const,
      retryable: false,
      message: "Cookie: secret; https://signed.example/?token=secret",
    };
    service.finished("one", "job:1", error);
    service.finished("one", "job:1", error);
    const events = service.events("owner").items;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("capture.failed");
    expect(JSON.stringify(events)).not.toContain("secret");
  });
  it("retains incidents across retries and emits recovered only after full success", () => {
    service.started("one", "first");
    service.finished(
      "one",
      "first",
      {
        source: "reader_image_archive",
        code: "READER_IMAGE_ARCHIVE_FAILED",
        retryable: true,
        message: "raw",
      },
      true,
    );
    service.started("one", "second");
    service.finished("one", "second", null);
    expect(service.events("owner").items.map((e) => e.type)).toEqual([
      "capture.partial",
      "capture.recovered",
    ]);
    expect(service.status("owner", "one")?.phase).toBe("recovered");
  });
  it("ignores old attempt callbacks and isolates users", () => {
    service.started("one", "old");
    service.started("one", "new");
    service.finished("one", "old", {
      source: "unknown",
      code: "UNKNOWN",
      retryable: false,
      message: "raw",
    });
    expect(service.events("owner").items).toHaveLength(0);
    expect(service.status("other", "one")).toBeNull();
    expect(service.events("other").items).toHaveLength(0);
  });
  it("waits for video results before declaring recovery", () => {
    service.started("one", "old");
    service.finished("one", "old", {
      code: "DOWNLOAD_FAILED",
      source: "asset_download",
      retryable: true,
      message: "raw",
    });
    service.started("one", "new");
    service.mediaStarted("one", "new");
    service.finished("one", "new", null);
    expect(service.status("owner", "one")?.phase).toBe("awaiting_media");
    expect(service.events("owner").items).toHaveLength(1);
    service.mediaFinished("one", "new", null);
    expect(service.status("owner", "one")?.phase).toBe("recovered");
  });
  it("records a video download failure as partial completion", () => {
    service.started("one", "new");
    service.mediaStarted("one", "new");
    service.mediaFinished("one", "new", {
      code: "DOWNLOAD_FAILED",
      source: "asset_download",
      retryable: true,
      message: "raw",
    });
    service.finished("one", "new", null);
    expect(service.events("owner").items[0].type).toBe("capture.partial");
  });
});
