import cron from "node-cron";

import { db } from "@karakeep/db";
import { CookieCloud } from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";

export class CookieCloudWorker {
  private timer?: ReturnType<typeof setInterval>;
  private task?: cron.ScheduledTask;
  private signature = "";
  private refreshing = false;
  private stopped = true;

  async start() {
    this.stopped = false;
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), 10000);
  }

  private async refresh() {
    if (this.refreshing || this.stopped) return;
    this.refreshing = true;
    try {
      const service = new CookieCloud(db);
      const settings = await service.settings();
      const signature = JSON.stringify([
        settings.enabled,
        settings.cron,
        settings.timezone,
      ]);
      if (this.stopped || signature === this.signature) return;
      this.task?.stop();
      this.task = undefined;
      this.signature = signature;
      if (!settings.enabled) return;
      this.task = cron.schedule(
        settings.cron,
        () => {
          const slot = `${signature}:${new Date().toISOString().slice(0, 16)}`;
          void service
            .sync(slot, signature)
            .then((result) => {
              if (result)
                logger.info(
                  `[cookiecloud] Sync finished: ${JSON.stringify(result)}`,
                );
            })
            .catch(() =>
              logger.warn(
                "[cookiecloud] Sync skipped or failed; check Resolver Settings.",
              ),
            );
        },
        { timezone: settings.timezone },
      );
    } catch {
      logger.warn("[cookiecloud] Could not load synchronization settings.");
    } finally {
      this.refreshing = false;
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.task?.stop();
  }
}
