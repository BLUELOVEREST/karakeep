import { describe, expect, it } from "vitest";

import type { ZBookmarkList } from "../types/lists";
import { listTreeRowsFromPaths } from "./listUtils";

function list(
  id: string,
  name: string,
  parentId: string | null = null,
): ZBookmarkList {
  return {
    id,
    name,
    parentId,
    icon: "📁",
    type: "manual",
    public: false,
    hasCollaborators: false,
    userRole: "owner",
  };
}

describe("listTreeRowsFromPaths", () => {
  const digital = list("digital", "数码");
  const nas = list("nas", "NAS", digital.id);
  const phone = list("phone", "手机", digital.id);
  const life = list("life", "生活");
  const allPaths = [[digital], [digital, nas], [digital, phone], [life]];

  it("shows only top-level lists by default", () => {
    expect(
      listTreeRowsFromPaths(allPaths, new Set()).map((row) => row.id),
    ).toEqual(["digital", "life"]);
  });

  it("shows direct children when a parent list is expanded", () => {
    expect(
      listTreeRowsFromPaths(allPaths, new Set(["digital"])).map((row) => ({
        id: row.id,
        depth: row.depth,
        hasChildren: row.hasChildren,
      })),
    ).toEqual([
      { id: "digital", depth: 0, hasChildren: true },
      { id: "nas", depth: 1, hasChildren: false },
      { id: "phone", depth: 1, hasChildren: false },
      { id: "life", depth: 0, hasChildren: false },
    ]);
  });

  it("shows matching descendants during search even when collapsed", () => {
    expect(
      listTreeRowsFromPaths(allPaths, new Set(), "NAS").map((row) => ({
        id: row.id,
        label: row.label,
      })),
    ).toEqual([{ id: "nas", label: "📁 数码 / 📁 NAS" }]);
  });
});
