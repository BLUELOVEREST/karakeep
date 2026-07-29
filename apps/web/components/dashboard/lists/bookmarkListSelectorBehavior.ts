interface TreeListRowActionInput {
  trigger: "row" | "expand";
  hasChildren: boolean;
}

export function getTreeListRowAction({
  trigger,
  hasChildren,
}: TreeListRowActionInput): "select" | "toggle" {
  if (trigger === "expand" && hasChildren) {
    return "toggle";
  }
  return "select";
}
