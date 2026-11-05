import { eq } from "drizzle-orm";

import { db } from "@karakeep/db";
import { bookmarkLinks } from "@karakeep/db/schema";
import { CaptureEvents } from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";
import { zCrawlErrorSchema } from "@karakeep/shared/types/bookmarks";

export async function captureLifecycle(
  action: (service: CaptureEvents) => unknown,
) {
  try {
    await action(new CaptureEvents(db));
  } catch {
    logger.warn(
      "[capture-events] Could not persist capture state; crawling is unaffected.",
    );
  }
}

export async function recordCaptureResult(
  bookmarkId: string,
  attemptId: string,
) {
  await captureLifecycle(async (service) => {
    const link = await db.query.bookmarkLinks.findFirst({
      where: eq(bookmarkLinks.id, bookmarkId),
    });
    const parsed = zCrawlErrorSchema.safeParse({
      code: link?.crawlErrorCode,
      source: link?.crawlErrorSource,
      message: "Capture error",
      retryable: link?.crawlErrorRetryable ?? false,
    });
    const error = parsed.success
      ? parsed.data
      : link?.crawlStatus === "failure"
        ? {
            code: "UNKNOWN" as const,
            source: "unknown" as const,
            message: "Unconfirmed failure",
            retryable: false,
          }
        : null;
    service.finished(
      bookmarkId,
      attemptId,
      error,
      !!error && link?.crawlStatus !== "failure",
    );
  });
}
