import { ZBookmarkList } from "../types/lists";

export interface ZBookmarkListTreeNode {
  item: ZBookmarkList;
  children: ZBookmarkListTreeNode[];
}

export type ZBookmarkListRoot = Record<string, ZBookmarkListTreeNode>;

export interface ZBookmarkListTreeRow {
  id: string;
  item: ZBookmarkList;
  path: ZBookmarkList[];
  label: string;
  depth: number;
  hasChildren: boolean;
}

export function listsToTree(lists: ZBookmarkList[]) {
  const idToList = lists.reduce<Record<string, ZBookmarkList>>((acc, list) => {
    acc[list.id] = list;
    return acc;
  }, {});

  const root: ZBookmarkListRoot = {};

  // Prepare all refs
  const refIdx = lists.reduce<Record<string, ZBookmarkListTreeNode>>(
    (acc, l) => {
      acc[l.id] = {
        item: l,
        children: [],
      };
      return acc;
    },
    {},
  );

  // Build the tree
  lists.forEach((list) => {
    const node = refIdx[list.id];
    if (list.parentId) {
      refIdx[list.parentId].children.push(node);
    } else {
      root[list.id] = node;
    }
  });

  const allPaths: ZBookmarkList[][] = [];
  const dfs = (node: ZBookmarkListTreeNode, path: ZBookmarkList[]) => {
    const list = idToList[node.item.id];
    const newPath = [...path, list];
    allPaths.push(newPath);
    node.children.forEach((child) => {
      dfs(child, newPath);
    });
  };

  Object.values(root).forEach((node) => {
    dfs(node, []);
  });

  return {
    allPaths,
    root,
    getPathById: (id: string) =>
      allPaths.find((path) => path[path.length - 1].id === id),
  };
}

export const listNameFromPath = (path: ZBookmarkList[]) =>
  path.map((p) => `${p.icon} ${p.name}`).join(" / ");

export function listTreeRowsFromPaths(
  allPaths: ZBookmarkList[][],
  expandedIds: Set<string>,
  search = "",
): ZBookmarkListTreeRow[] {
  const childCounts = new Map<string, number>();
  const rows = allPaths.map((path) => {
    const item = path[path.length - 1];
    const parent = path[path.length - 2];
    if (parent) {
      childCounts.set(parent.id, (childCounts.get(parent.id) ?? 0) + 1);
    }
    return {
      id: item.id,
      item,
      path,
      label: listNameFromPath(path),
      depth: path.length - 1,
      hasChildren: false,
    };
  });

  rows.forEach((row) => {
    row.hasChildren = (childCounts.get(row.id) ?? 0) > 0;
  });

  const normalizedSearch = search.trim().toLowerCase();
  if (normalizedSearch) {
    return rows.filter((row) =>
      row.label.toLowerCase().includes(normalizedSearch),
    );
  }

  return rows.filter((row) =>
    row.path.slice(0, -1).every((ancestor) => expandedIds.has(ancestor.id)),
  );
}

export function filterAssignableListPaths(
  allPaths: ZBookmarkList[][],
  {
    hideIds = [],
    listTypes = ["manual"],
  }: {
    hideIds?: string[];
    listTypes?: ZBookmarkList["type"][];
  } = {},
) {
  const hiddenIds = new Set(hideIds);

  return allPaths.filter((path) => {
    const item = path[path.length - 1];
    return (
      !hiddenIds.has(item.id) &&
      listTypes.includes(item.type) &&
      item.userRole !== "viewer"
    );
  });
}
