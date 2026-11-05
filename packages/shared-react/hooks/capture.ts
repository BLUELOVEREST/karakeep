import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "../trpc";

export function useCaptureStatus(bookmarkId: string, pending: boolean) {
  const api = useTRPC();
  const client = useQueryClient();
  const status = useQuery({
    ...api.capture.status.queryOptions({ bookmarkId }),
    retry: false,
    refetchInterval: (query) =>
      pending ||
      ["running", "retrying", "awaiting_media"].includes(
        query.state.data?.phase ?? "",
      )
        ? 5000
        : false,
  });
  const phase = status.data?.phase;
  const updatedAt = status.data?.updatedAt.getTime();
  useEffect(() => {
    if (
      updatedAt &&
      ["success", "failed", "partial", "recovered"].includes(phase ?? "")
    ) {
      // Old bookmarks can exceed the legacy createdAt-based polling window.
      void client.invalidateQueries(
        api.bookmarks.getBookmark.queryFilter({ bookmarkId }),
      );
    }
  }, [api, bookmarkId, client, phase, updatedAt]);
  return status;
}
