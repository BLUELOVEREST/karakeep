import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueClient } from "@karakeep/shared/queueing";

describe("Liteque Queue Provider", () => {
  let queueClient: QueueClient;

  afterEach(async () => {
    await queueClient?.shutdown?.();
  });

  beforeEach(async () => {
    vi.resetModules();
    process.env.DATA_DIR = await mkdtemp(
      path.join(tmpdir(), "karakeep-liteque-"),
    );
    process.env.NO_COLOR = "false";

    // Seed the 0.8 schema before constructing the provider, not a fresh 0.10 DB.
    const migrations = path.join(
      path.dirname(createRequire(import.meta.url).resolve("liteque")),
      "drizzle",
    );
    const legacy = [
      [
        "0000_wonderful_talisman",
        1720992922192,
        "f78939e040bfca780b2c2148de326d1cfff21271c91d7db99203b626f622ddd3",
      ],
      [
        "0001_wandering_giant_man",
        1730656128884,
        "9ec3f16fcbcad8de4f6735fc1e5def529aef2cb670f3ebd0ca5a012e095de7cc",
      ],
      [
        "0002_add_priority",
        1752135917070,
        "78c4c339deaac87429bd76495d3f4985f32f3c47da6694bc2345afe163269361",
      ],
      [
        "0003_add_available_at",
        1756665292211,
        "d14f290e140a5c55ca7f5d6d253dc5376bac76db8d307ec05af8a393f86bd991",
      ],
    ] as const;
    const db = new Database(path.join(process.env.DATA_DIR, "queue.db"));
    try {
      db.exec(
        'CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
      );
      for (const [tag, when, hash] of legacy) {
        const sql = await readFile(path.join(migrations, `${tag}.sql`), "utf8");
        expect(createHash("sha256").update(sql).digest("hex")).toBe(hash);
        db.exec(sql);
        db.prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        ).run(hash, when);
      }
      db.prepare(
        "INSERT INTO tasks (queue, payload, createdAt, allocationId, numRunsLeft, maxNumRuns) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("legacy", '{"value":73}', 1, "legacy-allocation", 1, 1);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name = 'tasks_dequeue_idx'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      db.close();
    }

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

  it("upgrades the 0.8 journal and processes its existing pending job", async () => {
    const db = new Database(path.join(process.env.DATA_DIR!, "queue.db"));
    try {
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name = 'tasks_dequeue_idx'",
          )
          .get(),
      ).toEqual({ name: "tasks_dequeue_idx" });
      expect(
        db.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get(),
      ).toEqual({ count: 5 });
    } finally {
      db.close();
    }
    const queue = queueClient.createQueue<{ value: number }>("legacy", {
      defaultJobArgs: { numRetries: 0 },
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
      { concurrency: 1, timeoutSecs: 5, pollIntervalMs: 1 },
    );
    await runner.runUntilEmpty?.();
    expect(processed).toEqual([73]);
    expect(await queue.stats()).toEqual({
      pending: 0,
      pending_retry: 0,
      running: 0,
      failed: 0,
    });
    await queueClient.prepare();
  });

  it("preserves jobs and idempotency across repeated migrations", async () => {
    const queue = queueClient.createQueue<{ value: number }>("upgrade", {
      defaultJobArgs: { numRetries: 1 },
      keepFailedJobs: true,
    });
    const id = await queue.enqueue({ value: 42 }, { idempotencyKey: "saved" });
    expect(id).toBeDefined();
    await queueClient.prepare();
    await queueClient.prepare();
    expect(
      await queue.enqueue({ value: 99 }, { idempotencyKey: "saved" }),
    ).toBeUndefined();
    const processed: number[] = [];
    const runner = queueClient.createRunner(
      queue,
      {
        run: async (job) => {
          processed.push(job.data.value);
        },
      },
      { concurrency: 1, timeoutSecs: 5, pollIntervalMs: 1 },
    );
    await runner.runUntilEmpty?.();
    expect(processed).toEqual([42]);
    expect(await queue.stats()).toEqual({
      pending: 0,
      pending_retry: 0,
      running: 0,
      failed: 0,
    });
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
