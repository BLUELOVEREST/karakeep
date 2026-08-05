import path from "node:path";
import assert from "node:assert";

import { Semaphore } from "async-mutex";
import Database from "better-sqlite3";
import { buildDBClient, migrateDB } from "liteque";

import type { PluginProvider } from "@karakeep/shared/plugins";
import type {
  DequeuedJob,
  EnqueueOptions,
  Queue,
  QueueClient,
  QueueOptions,
  Runner,
  RunnerFuncs,
  RunnerOptions,
} from "@karakeep/shared/queueing";
import serverConfig from "@karakeep/shared/config";
import {
  QueueRetryAfterError,
  queueOptionsEqual,
} from "@karakeep/shared/queueing";

type TaskStatus = "pending" | "running" | "pending_retry" | "failed";

interface Task {
  id: number;
  queue: string;
  payload: string;
  createdAt: number;
  availableAt: number | null;
  status: TaskStatus;
  expireAt: number | null;
  allocationId: string;
  numRunsLeft: number;
  maxNumRuns: number;
  idempotencyKey: string | null;
  priority: number;
}

function generateAllocationId() {
  return Math.random().toString(36).substring(2, 15);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

class LitequeQueueWrapper<T> implements Queue<T> {
  constructor(
    private readonly _name: string,
    private readonly db: Database.Database,
    public readonly opts: QueueOptions,
  ) {}

  ensureInit(): Promise<void> {
    return Promise.resolve();
  }

  name(): string {
    return this._name;
  }

  async enqueue(
    payload: T,
    options?: EnqueueOptions,
  ): Promise<string | undefined> {
    const opts = options ?? {};
    const numRetries = this.opts.defaultJobArgs.numRetries;
    const job = this.db
      .prepare(
        `
        INSERT OR IGNORE INTO tasks (
          queue, payload, createdAt, availableAt, status, allocationId,
          numRunsLeft, maxNumRuns, idempotencyKey, priority
        )
        VALUES (
          @queue, @payload, @createdAt, @availableAt, 'pending', @allocationId,
          @numRunsLeft, @maxNumRuns, @idempotencyKey, @priority
        )
        RETURNING id
      `,
      )
      .get({
        queue: this._name,
        payload: JSON.stringify(payload),
        createdAt: nowSeconds(),
        availableAt: Date.now() + (opts.delayMs ?? 0),
        numRunsLeft: numRetries + 1,
        maxNumRuns: numRetries + 1,
        allocationId: generateAllocationId(),
        idempotencyKey: opts.idempotencyKey ?? null,
        priority: opts.priority ?? 0,
      }) as { id: number } | undefined;
    return job ? String(job.id) : undefined;
  }

  async stats(): Promise<{
    pending: number;
    pending_retry: number;
    running: number;
    failed: number;
  }> {
    const res = this.db
      .prepare(
        `
        SELECT status, count(*) as count
        FROM tasks
        WHERE queue = ?
        GROUP BY status
      `,
      )
      .all(this._name) as { status: TaskStatus; count: number }[];
    return res.reduce(
      (acc, r) => {
        acc[r.status] += r.count;
        return acc;
      },
      {
        pending: 0,
        pending_retry: 0,
        running: 0,
        failed: 0,
      },
    );
  }

  async cancelAllNonRunning(): Promise<number> {
    const deleted = this.db
      .prepare(
        `
        DELETE FROM tasks
        WHERE queue = ?
          AND status IN ('pending', 'pending_retry', 'failed')
        RETURNING id
      `,
      )
      .all(this._name) as { id: number }[];
    return deleted.length;
  }

  attemptDequeue(options: { timeoutSecs: number }): Task | null {
    return this.db.transaction(() => {
      const job = this.db
        .prepare(
          `
          SELECT *
          FROM tasks
          WHERE queue = @queue
            AND (availableAt <= @nowMs OR availableAt IS NULL)
            AND (
              status IN ('pending', 'pending_retry')
              OR (status = 'running' AND expireAt < @nowSecs)
            )
          ORDER BY priority ASC, createdAt ASC
          LIMIT 1
        `,
        )
        .get({
          queue: this._name,
          nowMs: Date.now(),
          nowSecs: nowSeconds(),
        }) as Task | undefined;

      if (!job) {
        return null;
      }
      if (job.numRunsLeft === 0) {
        this.finalize(job.id, job.allocationId, "failed");
        return null;
      }

      const result = this.db
        .prepare(
          `
          UPDATE tasks
          SET
            status = 'running',
            numRunsLeft = @numRunsLeft,
            allocationId = @newAllocationId,
            expireAt = @expireAt
          WHERE id = @id AND allocationId = @allocationId
          RETURNING *
        `,
        )
        .get({
          id: job.id,
          allocationId: job.allocationId,
          numRunsLeft: job.numRunsLeft - 1,
          newAllocationId: generateAllocationId(),
          expireAt: Math.floor(
            (Date.now() + options.timeoutSecs * 1000) / 1000,
          ),
        }) as Task | undefined;
      if (!result) {
        return null;
      }
      return result;
    })();
  }

  finalize(
    id: number,
    allocationId: string,
    status: "completed" | "failed" | "pending_retry",
    availableAt = Date.now(),
    refundRetry = false,
  ) {
    if (
      status === "completed" ||
      (status === "failed" && !this.opts.keepFailedJobs)
    ) {
      this.db
        .prepare("DELETE FROM tasks WHERE id = ? AND allocationId = ?")
        .run(id, allocationId);
      return;
    }

    this.db
      .prepare(
        `
        UPDATE tasks
        SET
          status = @status,
          expireAt = NULL,
          availableAt = @availableAt,
          numRunsLeft = numRunsLeft + @retryRefund
        WHERE id = @id AND allocationId = @allocationId
      `,
      )
      .run({
        id,
        allocationId,
        status,
        availableAt,
        retryRefund: refundRetry ? 1 : 0,
      });
  }
}

class LitequeRunner<T, R = void> implements Runner<T> {
  private stopping = false;

  constructor(
    private readonly queue: LitequeQueueWrapper<T>,
    private readonly funcs: RunnerFuncs<T, R>,
    private readonly opts: RunnerOptions<T>,
  ) {}

  async run(): Promise<void> {
    await this.runImpl(false);
  }

  stop(): void {
    this.stopping = true;
  }

  async runUntilEmpty(): Promise<void> {
    await this.runImpl(true);
  }

  private async runImpl(breakOnEmpty: boolean): Promise<void> {
    const semaphore = new Semaphore(this.opts.concurrency);
    const inFlight = new Map<number, Promise<void>>();

    while (!this.stopping) {
      await semaphore.waitForUnlock();
      const job = this.queue.attemptDequeue({
        timeoutSecs: this.opts.timeoutSecs,
      });
      if (!job) {
        if (inFlight.size > 0 || !breakOnEmpty) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.opts.pollIntervalMs ?? 1000),
          );
          continue;
        }

        const queueStats = await this.queue.stats();
        if (queueStats.pending + queueStats.pending_retry > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.opts.pollIntervalMs ?? 1000),
          );
          continue;
        }
        break;
      }

      const [, release] = await semaphore.acquire();
      inFlight.set(
        job.id,
        this.runOnce(job).finally(() => {
          inFlight.delete(job.id);
          release();
        }),
      );
    }

    await Promise.allSettled(inFlight.values());
  }

  private async runOnce(job: Task): Promise<void> {
    assert(job.allocationId);
    const runNumber = job.maxNumRuns - job.numRunsLeft - 1;
    let parsed: T;
    try {
      parsed = JSON.parse(job.payload);
      if (this.opts.validator) {
        parsed = this.opts.validator.parse(parsed);
      }
    } catch (e) {
      await this.funcs
        .onError?.({
          id: job.id.toString(),
          error: e instanceof Error ? e : new Error(String(e)),
          priority: job.priority,
          runNumber,
          numRetriesLeft: job.numRunsLeft,
        })
        .catch(() => undefined);
      this.queue.finalize(
        job.id,
        job.allocationId,
        job.numRunsLeft <= 0 ? "failed" : "pending_retry",
      );
      return;
    }

    const abortController = new AbortController();
    const dequeuedJob: DequeuedJob<T> = {
      id: job.id.toString(),
      data: parsed,
      priority: job.priority,
      runNumber,
      abortSignal: abortController.signal,
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.funcs.run(dequeuedJob),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            abortController.abort();
            reject(
              new Error(
                `Queue ${this.queue.name()} job ${job.id} run ${runNumber} timed out after ${this.opts.timeoutSecs}s`,
              ),
            );
          }, this.opts.timeoutSecs * 1000);
        }),
      ]);
      await this.funcs.onComplete?.(dequeuedJob, result);
      this.queue.finalize(job.id, job.allocationId, "completed");
    } catch (e) {
      if (e instanceof QueueRetryAfterError) {
        this.queue.finalize(
          job.id,
          job.allocationId,
          "pending_retry",
          Date.now() + e.delayMs,
          true,
        );
        return;
      }

      await this.funcs
        .onError?.({
          ...dequeuedJob,
          error: e instanceof Error ? e : new Error(String(e)),
          runNumber,
          numRetriesLeft: job.numRunsLeft,
        })
        .catch(() => undefined);
      this.queue.finalize(
        job.id,
        job.allocationId,
        job.numRunsLeft <= 0 ? "failed" : "pending_retry",
      );
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

class LitequeQueueClient implements QueueClient {
  private readonly dbPath = path.join(serverConfig.dataDir, "queue.db");
  private readonly migrationDb = buildDBClient(this.dbPath, {
    walEnabled: serverConfig.database.walMode,
  });
  private readonly db = new Database(this.dbPath);

  constructor() {
    if (serverConfig.database.walMode) {
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
    } else {
      this.db.pragma("journal_mode = DELETE");
    }
    this.db.pragma("cache_size = -65536");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("temp_store = MEMORY");
  }

  private queues = new Map<string, LitequeQueueWrapper<unknown>>();

  async prepare(): Promise<void> {
    migrateDB(this.migrationDb);
  }

  async start(): Promise<void> {
    // No-op for sqlite
  }

  createQueue<T>(name: string, options: QueueOptions): Queue<T> {
    const existing = this.queues.get(name);
    if (existing) {
      if (!queueOptionsEqual(existing.opts, options)) {
        throw new Error(`Queue ${name} already exists with different options`);
      }
      return existing as LitequeQueueWrapper<T>;
    }
    const wrapper = new LitequeQueueWrapper<T>(name, this.db, options);
    this.queues.set(name, wrapper);
    return wrapper;
  }

  createRunner<T, R = void>(
    queue: Queue<T>,
    funcs: RunnerFuncs<T, R>,
    opts: RunnerOptions<T>,
  ): Runner<T> {
    const name = queue.name();
    let wrapper = this.queues.get(name);
    if (!wrapper) {
      throw new Error(`Queue ${name} not found`);
    }

    const runner = new LitequeRunner<T, R>(
      wrapper as LitequeQueueWrapper<T>,
      funcs,
      opts,
    );

    return {
      run: () => runner.run(),
      stop: () => runner.stop(),
      runUntilEmpty: () => runner.runUntilEmpty(),
    };
  }

  async shutdown(): Promise<void> {
    this.db.close();
  }
}

export class LitequeQueueProvider implements PluginProvider<QueueClient> {
  private client: QueueClient | null = null;

  async getClient(): Promise<QueueClient | null> {
    if (!this.client) {
      const client = new LitequeQueueClient();
      this.client = client;
    }
    return this.client;
  }
}
