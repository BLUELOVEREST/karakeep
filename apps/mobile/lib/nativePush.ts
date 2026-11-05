import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { buildApiHeaders } from "./utils";

export const nativeFcmConfigured = () =>
  Platform.OS === "android" && Constants.expoConfig?.extra?.fcmEnabled === true;

export async function disableNativePush() {
  if (!nativeFcmConfigured()) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await Notifications.unregisterForNotificationsAsync();
        await Notifications.dismissAllNotificationsAsync();
        await Notifications.clearLastNotificationResponseAsync();
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "Unable to confirm push deregistration; check Android notification settings",
              ),
            ),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function removeRemotePushRegistration(settings: {
  address?: string;
  apiKey?: string;
  apiKeyId?: string;
  customHeaders?: Record<string, string>;
}) {
  if (!settings.address || !settings.apiKey || !settings.apiKeyId) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    await fetch(
      `${settings.address.replace(/\/+$/, "")}/api/v1/capture/devices/${encodeURIComponent(settings.apiKeyId)}`,
      {
        method: "DELETE",
        headers: buildApiHeaders(settings.apiKey, settings.customHeaders),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestNativePushToken(requestPermission: boolean) {
  if (!nativeFcmConfigured())
    throw new Error("This APK was built without Firebase configuration");
  await Notifications.setNotificationChannelAsync("capture-events", {
    name: "Capture results",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  const permission = requestPermission
    ? await Notifications.requestPermissionsAsync()
    : await Notifications.getPermissionsAsync();
  if (!permission.granted)
    throw new Error("Notification permission is not granted");
  return String((await Notifications.getDevicePushTokenAsync()).data);
}
