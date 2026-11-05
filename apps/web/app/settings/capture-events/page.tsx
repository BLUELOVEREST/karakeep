"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { captureAdvice } from "@karakeep/shared/types/captureEvents";

export default function CaptureEventsPage() {
  const api = useTRPC();
  const events = useQuery({
    ...api.capture.recent.queryOptions(),
    refetchInterval: 15000,
  });
  return (
    <SettingsPage title="Capture events">
      {events.isError && (
        <p role="alert" className="text-destructive">
          Unable to load capture events.
        </p>
      )}
      {events.data?.length === 0 && (
        <p className="text-muted-foreground">No capture events.</p>
      )}
      <div className="divide-y">
        {events.data?.map((event) => (
          <article key={event.id} className="space-y-2 py-4">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span>
                {event.platform} · {event.type}
              </span>
              <time className="text-muted-foreground">
                {new Date(event.createdAt).toLocaleString()}
              </time>
            </div>
            {event.title && <p className="font-medium">{event.title}</p>}
            <p>{event.message}</p>
            {event.code && (
              <p className="text-sm text-muted-foreground">
                {event.code}: {captureAdvice(event.code)}
              </p>
            )}
            {event.bookmarkId && (
              <Link
                className="text-sm text-primary underline"
                href={`/dashboard/preview/${event.bookmarkId}`}
              >
                Open bookmark
              </Link>
            )}
          </article>
        ))}
      </div>
    </SettingsPage>
  );
}
