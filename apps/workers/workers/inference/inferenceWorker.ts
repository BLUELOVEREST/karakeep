import { eq } from "drizzle-orm";
import { workerStatsCounter } from "metrics";
import { withWorkerEventLog, withWorkerTracing } from "workerTracing";

import type { ZOpenAIRequest } from "@karakeep/shared-server";
import { db } from "@karakeep/db";
import { bookmarks, users } from "@karakeep/db/schema";
import {
  addLogFields,
  getUserAIClient,
  OpenAIQueue,
  zOpenAIRequestSchema,
} from "@karakeep/shared-server";
import serverConfig from "@karakeep/shared/config";
import logger from "@karakeep/shared/logger";
import { DequeuedJob, getQueueClient } from "@karakeep/shared/queueing";

import { runSummarization } from "./summarize";
import { runTagging } from "./tagging";

async function attemptMarkStatus(
  jobData: object | undefined,
  status: "success" | "failure" | null,
) {
  if (!jobData) {
    return;
  }
  try {
    const request = zOpenAIRequestSchema.parse(jobData);
    await db
      .update(bookmarks)
      .set({
        ...(request.type === "summarize"
          ? { summarizationStatus: status }
          : {}),
        ...(request.type === "tag" ? { taggingStatus: status } : {}),
      })
      .where(eq(bookmarks.id, request.bookmarkId));
  } catch (e) {
    logger.error(`Something went wrong when marking the tagging status: ${e}`);
  }
}

export class OpenAiWorker {
  static async build() {
    logger.info("Starting inference worker ...");
    const worker = (await getQueueClient())!.createRunner<
      ZOpenAIRequest,
      "completed" | "skipped"
    >(
      OpenAIQueue,
      {
        run: withWorkerTracing(
          "inferenceWorker.run",
          withWorkerEventLog("inferenceWorker.run", runOpenAI),
        ),
        onComplete: async (job, result) => {
          workerStatsCounter.labels("inference", result).inc();
          const jobId = job.id;
          logger.info(`[inference][${jobId}] ${result}`);
          await attemptMarkStatus(
            job.data,
            result === "completed" ? "success" : null,
          );
        },
        onError: async (job) => {
          workerStatsCounter.labels("inference", "failed").inc();
          const jobId = job.id;
          logger.error(
            `[inference][${jobId}] inference job failed: ${job.error}\n${job.error.stack}`,
          );
          if (job.numRetriesLeft == 0) {
            workerStatsCounter.labels("inference", "failed_permanent").inc();
            await attemptMarkStatus(job?.data, "failure");
          }
        },
      },
      {
        concurrency: serverConfig.inference.numWorkers,
        pollIntervalMs: 1000,
        timeoutSecs: serverConfig.inference.jobTimeoutSec,
      },
    );

    return worker;
  }
}

async function runOpenAI(
  job: DequeuedJob<ZOpenAIRequest>,
): Promise<"completed" | "skipped"> {
  const jobId = job.id;

  const request = zOpenAIRequestSchema.safeParse(job.data);
  if (!request.success) {
    throw new Error(
      `[inference][${jobId}] Got malformed job request: ${request.error.toString()}`,
    );
  }

  const { bookmarkId } = request.data;
  const bookmark = await db.query.bookmarks.findFirst({
    where: eq(bookmarks.id, bookmarkId),
    columns: {
      userId: true,
    },
    with: { asset: { columns: { assetType: true } } },
  });

  if (!bookmark) {
    throw new Error(`[inference][${jobId}] Bookmark not found`);
  }

  addLogFields<"inferenceWorker.run">({
    "bookmark.id": bookmarkId,
    "inference.type": request.data.type,
    ...(bookmark ? { "user.id": bookmark.userId } : {}),
  });
  const preferences = await db.query.users.findFirst({
    where: eq(users.id, bookmark.userId),
    columns: { autoTaggingEnabled: true, autoSummarizationEnabled: true },
  });
  if (
    (request.data.type === "tag" &&
      preferences?.autoTaggingEnabled === false) ||
    (request.data.type === "summarize" &&
      preferences?.autoSummarizationEnabled !== true)
  ) {
    return "skipped";
  }
  const modality =
    request.data.type === "tag" && bookmark.asset?.assetType === "image"
      ? "vision"
      : "text";
  const inferenceClient = await getUserAIClient(db, bookmark.userId, modality);
  if (!inferenceClient) {
    return "skipped";
  }
  switch (request.data.type) {
    case "summarize":
      return runSummarization(bookmarkId, job, inferenceClient);
    case "tag":
      return runTagging(bookmarkId, job, inferenceClient);
    default:
      throw new Error(`Unknown inference type: ${request.data.type}`);
  }
}
