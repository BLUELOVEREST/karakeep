import { describe, expect, it } from "vitest";

import { notificationDestination } from "./notificationRouting";

describe("push notification routing", () => {
  const event = {
    scope: "current-login",
    type: "capture.failed",
    eventId: "42",
    bookmarkId: "bookmark-id",
  };
  it("opens only a bookmark from the current login scope", () => {
    expect(notificationDestination(event, "current-login")).toEqual({
      pathname: "/dashboard/bookmarks/[slug]",
      params: { slug: "bookmark-id" },
    });
    expect(notificationDestination(event, "old-login")).toBeNull();
    expect(notificationDestination(event, undefined)).toBeNull();
  });
  it("does not allow a supplied URL or arbitrary path to be opened", () => {
    expect(
      notificationDestination(
        { ...event, bookmarkId: "https://evil.test" },
        "current-login",
      ),
    ).toEqual({ pathname: "/dashboard/settings/capture-events" });
    expect(
      notificationDestination({ ...event, type: "other" }, "current-login"),
    ).toBeNull();
  });
});
