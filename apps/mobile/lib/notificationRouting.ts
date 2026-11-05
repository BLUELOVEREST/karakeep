export function notificationDestination(
  data: unknown,
  scope: string | undefined,
) {
  if (!scope || !data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (
    value.scope !== scope ||
    ![
      "capture.failed",
      "capture.partial",
      "capture.recovered",
      "push.test",
    ].includes(String(value.type)) ||
    !/^\d+$/.test(String(value.eventId))
  )
    return null;
  if (
    typeof value.bookmarkId === "string" &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(value.bookmarkId)
  ) {
    return {
      pathname: "/dashboard/bookmarks/[slug]" as const,
      params: { slug: value.bookmarkId },
    };
  }
  return { pathname: "/dashboard/settings/capture-events" as const };
}
