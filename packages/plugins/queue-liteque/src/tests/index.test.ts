import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueClient } from "@karakeep/shared/queueing";

describe("Liteque Queue Provider", () => {
  let queueClient: QueueClient;

  beforeEach(async () => {
    vi.resetModules();
    process.env.DATA_DIR = await mkdtemp(
      path.join(tmpdir(), "karakeep-liteque-"),
    );
    process.env.NO_COLOR = "false";

    const { LitequeQueueProvider } = await import("../index");
    const provider = new LitequeQueueProvider();
    const client = await provider.getClient();
    if (!client) {
      throw new Error("Failed to create liteque queue client");
    }

    queueClient = client;
    await queueClient.prepare();
    await queueClient.start();
  });

  it("dequeues pending jobs with better-sqlite3 sync transactions", async () => {
    const queue = queueClient.createQueue<{ value: number }>("test-queue", {
      defaultJobArgs: {
        numRetries: 0,
      },
      keepFailedJobs: false,
    });
    const processed: number[] = [];

    const runner = queueClient.createRunner(
      queue,
      {
        run: async (job) => {
          processed.push(job.data.value);
        },
      },
      {
        concurrency: 1,
        timeoutSecs: 5,
        pollIntervalMs: 1,
      },
    );

    await queue.enqueue({ value: 42 });
    await runner.runUntilEmpty?.();

    expect(processed).toEqual([42]);
    await expect(queue.stats()).resolves.toMatchObject({
      pending: 0,
      pending_retry: 0,
      running: 0,
      failed: 0,
    });
  });
});
