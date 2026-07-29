import { describe, expect, it } from "vitest";

import { buildBookmarkPostCreationActions } from "@karakeep/shared-react/hooks/bookmarks";

describe("buildBookmarkPostCreationActions", () => {
  it("does not add a bookmark to a list when no list is selected", () => {
    expect(
      buildBookmarkPostCreationActions("bookmark-1", undefined, null),
    ).toEqual([]);
  });

  it("adds a bookmark to the explicitly selected list", () => {
    expect(
      buildBookmarkPostCreationActions("bookmark-1", undefined, "list-1"),
    ).toEqual([
      {
        type: "addToList",
        input: { bookmarkId: "bookmark-1", listId: "list-1" },
      },
    ]);
  });

  it("falls back to the current grid list when no explicit list is selected", () => {
    expect(
      buildBookmarkPostCreationActions(
        "bookmark-1",
        { listId: "current-list" },
        null,
      ),
    ).toContainEqual({
      type: "addToList",
      input: { bookmarkId: "bookmark-1", listId: "current-list" },
    });
  });
});
