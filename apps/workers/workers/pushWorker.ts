import { db } from "@karakeep/db";
import { FcmTransport, PushDispatcher } from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";

export class PushWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private active?: Promise<void>;
  private readonly dispatcher = new PushDispatcher(db, new FcmTransport());
  start() {
    const tick = () => {
      if (this.running) return;
      this.running = true;
      this.active = this.dispatcher
        .tick()
        .catch(() => {
          logger.warn(
            "[push] Dispatch failed; pending deliveries will be retried.",
          );
        })
        .finally(() => {
          this.running = false;
        });
    };
    tick();
    this.timer = setInterval(tick, 5000);
  }
  async stop() {
    clearInterval(this.timer);
    this.dispatcher.stop();
    await this.active;
  }
}
