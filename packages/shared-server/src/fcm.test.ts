import { beforeEach, describe, expect, it, vi } from "vitest";

import { FcmTransport } from "./fcm";

const sdk = vi.hoisted(() => ({ send: vi.fn(async () => "message-id") }));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () =>
    JSON.stringify({
      type: "service_account",
      project_id: "test-project",
      client_email: "test@test.iam.gserviceaccount.com",
      private_key: "test-key-not-real",
    }),
  ),
}));
vi.mock("firebase-admin/app", () => ({
  getApps: () => [],
  cert: () => ({}),
  initializeApp: () => ({}),
}));
vi.mock("firebase-admin/messaging", () => ({ getMessaging: () => sdk }));
beforeEach(() => {
  sdk.send.mockReset();
});
const message = {
  token: "private-token",
  title: "Capture failed",
  body: "Safe message",
  tag: "event-1",
  data: { eventId: "1" },
};

describe("FCM adapter", () => {
  it("uses a notification payload, Android channel and private lockscreen visibility", async () => {
    await new FcmTransport("test-file").send(message);
    expect(sdk.send).toHaveBeenCalledWith(
      expect.objectContaining({
        token: message.token,
        data: message.data,
        android: expect.objectContaining({
          notification: expect.objectContaining({
            channelId: "capture-events",
            visibility: "private",
          }),
        }),
      }),
    );
  });
  it("does not expose Firebase error text and revokes only confirmed invalid tokens", async () => {
    sdk.send.mockRejectedValue({
      code: "messaging/registration-token-not-registered",
      message: "private-key secret",
    });
    await expect(
      new FcmTransport("test-file").send(message),
    ).rejects.toMatchObject({ code: "FCM_TOKEN_REVOKED", revokeDevice: true });
    sdk.send.mockRejectedValue({
      code: "messaging/invalid-argument",
      message: "private-token secret",
    });
    await expect(
      new FcmTransport("test-file").send(message),
    ).rejects.toMatchObject({
      code: "FCM_REQUEST_REJECTED",
      revokeDevice: false,
      retryable: false,
    });
  });
});
