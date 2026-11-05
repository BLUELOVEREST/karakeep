import { beforeEach, describe, expect, it } from "vitest";

import { CaptureEvents } from "@karakeep/shared-server";
import {
  bookmarks,
  bookmarkLinks,
  pushDevices,
  users,
} from "@karakeep/db/schema";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import type { CustomTestContext } from "../testUtils";
import { buildTestContext, getApiCaller } from "../testUtils";

beforeEach<CustomTestContext>(async (context) => {
  Object.assign(context, await buildTestContext(true));
});

describe("capture event ownership", () => {
  it<CustomTestContext>("isolates events, states and delivery status between users", async ({
    db,
    apiCallers,
  }) => {
    const owner = db.select().from(users).all()[0];
    db.insert(bookmarks)
      .values({ id: "incident", userId: owner.id, type: BookmarkTypes.LINK })
      .run();
    db.insert(bookmarkLinks)
      .values({ id: "incident", url: "https://example.com" })
      .run();
    const service = new CaptureEvents(db);
    service.started("incident", "attempt");
    service.finished("incident", "attempt", {
      source: "unknown",
      code: "UNKNOWN",
      message: "secret",
      retryable: false,
    });
    const events = await apiCallers[0].capture.events({ cursor: 0, limit: 10 });
    expect(events.items).toHaveLength(1);
    expect(
      (await apiCallers[1].capture.events({ cursor: 0, limit: 10 })).items,
    ).toHaveLength(0);
    expect(
      await apiCallers[1].capture.status({ bookmarkId: "incident" }),
    ).toBeNull();
    expect(
      await apiCallers[1].capture.deliveries({ eventId: events.items[0].id }),
    ).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain("secret");
    await expect(getApiCaller(db).capture.recent()).rejects.toThrow();
  });
  it<CustomTestContext>("never returns device tokens and only unregisters owned devices", async ({
    db,
    apiCallers,
  }) => {
    const owner = db.select().from(users).all()[0];
    db.insert(pushDevices)
      .values({
        id: "phone",
        userId: owner.id,
        token: "private-device-token",
        scope: "scope",
        createdAt: new Date(),
        modifiedAt: new Date(),
      })
      .run();
    expect(
      JSON.stringify(await apiCallers[0].capture.pushStatus()),
    ).not.toContain("private-device-token");
    await apiCallers[1].capture.unregisterDevice({ scope: "scope" });
    expect(db.select().from(pushDevices).all()).toHaveLength(1);
    await apiCallers[0].capture.unregisterDevice({ scope: "scope" });
    expect(db.select().from(pushDevices).all()).toHaveLength(0);
  });
});
