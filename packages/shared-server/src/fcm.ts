import { readFile } from "node:fs/promises";
import { z } from "zod";

import serverConfig from "@karakeep/shared/config";

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  tag: string;
  data: Record<string, string>;
}

export interface NotificationTransport {
  readonly channel: string;
  readonly configured: boolean;
  send(message: PushMessage): Promise<void>;
}

export class PushDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly revokeDevice = false,
  ) {
    super(code);
  }
}

export class FcmTransport implements NotificationTransport {
  readonly channel = "fcm";
  private messaging?: Promise<import("firebase-admin/messaging").Messaging>;
  constructor(
    private readonly credentialFile = serverConfig.notifications
      .fcmServiceAccountFile,
  ) {}
  get configured() {
    return !!this.credentialFile;
  }

  private async client() {
    if (!this.configured)
      throw new PushDeliveryError("FCM_UNCONFIGURED", false);
    this.messaging ??= (async () => {
      const account = z
        .object({
          type: z.literal("service_account"),
          project_id: z.string().min(1),
          client_email: z.string().email(),
          private_key: z.string().min(1),
        })
        .parse(JSON.parse(await readFile(this.credentialFile!, "utf8")));
      const { cert, initializeApp, getApps } =
        await import("firebase-admin/app");
      const { getMessaging } = await import("firebase-admin/messaging");
      const app =
        getApps().find((app) => app.name === "karakeep-fcm") ??
        initializeApp(
          {
            credential: cert({
              projectId: account.project_id,
              clientEmail: account.client_email,
              privateKey: account.private_key,
            }),
          },
          "karakeep-fcm",
        );
      return getMessaging(app);
    })().catch(() => {
      this.messaging = undefined;
      throw new PushDeliveryError("FCM_CONFIGURATION_ERROR", false);
    });
    return this.messaging;
  }

  async send(message: PushMessage) {
    try {
      const client = await this.client();
      await client.send({
        token: message.token,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: {
          priority: "high",
          ttl: 24 * 60 * 60 * 1000,
          collapseKey: "karakeep-capture-events",
          notification: {
            channelId: "capture-events",
            tag: message.tag,
            visibility: "private",
            defaultSound: true,
          },
        },
      });
    } catch (error) {
      if (error instanceof PushDeliveryError) throw error;
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unknown";
      if (
        [
          "messaging/registration-token-not-registered",
          "messaging/invalid-registration-token",
        ].includes(code)
      )
        throw new PushDeliveryError("FCM_TOKEN_REVOKED", false, true);
      if (
        [
          "messaging/invalid-argument",
          "messaging/mismatched-credential",
          "messaging/authentication-error",
          "app/invalid-credential",
        ].includes(code)
      )
        throw new PushDeliveryError("FCM_REQUEST_REJECTED", false);
      throw new PushDeliveryError("FCM_TEMPORARILY_UNAVAILABLE", true);
    }
  }
}
