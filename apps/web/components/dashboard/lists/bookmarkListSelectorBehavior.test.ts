import { describe, expect, it } from "vitest";

import { getTreeListRowAction } from "./bookmarkListSelectorBehavior";

describe("getTreeListRowAction", () => {
  it("selects parent rows even when they have children", () => {
    expect(
      getTreeListRowAction({
        trigger: "row",
        hasChildren: true,
      }),
    ).toBe("select");
  });

  it("expands parent rows from the arrow control", () => {
    expect(
      getTreeListRowAction({
        trigger: "expand",
        hasChildren: true,
      }),
    ).toBe("toggle");
  });

  it("selects leaf rows", () => {
    expect(
      getTreeListRowAction({
        trigger: "row",
        hasChildren: false,
      }),
    ).toBe("select");
  });
});
