import { beforeEach, describe, expect, it } from "vitest";

import type { CustomTestContext } from "../testUtils";
import { buildTestContext, getApiCaller } from "../testUtils";

beforeEach<CustomTestContext>(async (context) => {
  Object.assign(context, await buildTestContext(true));
});

describe("CookieCloud admin settings", () => {
  it<CustomTestContext>("rejects ordinary users and unauthenticated callers", async ({
    db,
  }) => {
    const input = {
      enabled: false,
      url: "",
      uuid: "",
      cron: "0 * * * *",
      timezone: "UTC",
    };
    for (const caller of [
      getApiCaller(db),
      getApiCaller(db, "user", "user@test.com"),
    ]) {
      await expect(
        caller.resolverSettings.cookieCloudStatus(),
      ).rejects.toThrow();
      await expect(
        caller.resolverSettings.saveCookieCloud(input),
      ).rejects.toThrow();
      await expect(caller.resolverSettings.syncCookieCloud()).rejects.toThrow();
    }
  });
  it<CustomTestContext>("lets admins configure synchronization without returning passwords", async ({
    db,
  }) => {
    const api = getApiCaller(db, "admin", "admin@test.com", "admin");
    const result = await api.resolverSettings.saveCookieCloud({
      enabled: true,
      url: "https://cookiecloud.test",
      uuid: "uuid",
      password: "private-password",
      cron: "0 */12 * * *",
      timezone: "Asia/Shanghai",
    });
    expect(result.passwordConfigured).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private-password");
    expect(await api.resolverSettings.cookieCloudStatus()).not.toHaveProperty(
      "password",
    );
  });
});
