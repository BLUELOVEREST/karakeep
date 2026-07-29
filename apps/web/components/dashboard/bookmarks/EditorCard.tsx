import { useBookmarkLayoutSwitch } from "@/lib/userLocalSettings/bookmarksLayout";
import { cn } from "@/lib/utils";

import BookmarkEditorForm from "./BookmarkEditorForm";

export default function EditorCard({
  className,
  showListSelector = false,
}: {
  className?: string;
  showListSelector?: boolean;
}) {
  const cardHeight = useBookmarkLayoutSwitch({
    grid: "h-96",
    masonry: "h-48",
    list: undefined,
    compact: undefined,
  });

  return (
    <BookmarkEditorForm
      className={cn(className, "rounded-xl bg-card p-4", cardHeight)}
      showHeader={true}
      showListSelector={showListSelector}
    />
  );
}
