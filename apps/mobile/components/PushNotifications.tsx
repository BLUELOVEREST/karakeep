import { useEffect } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { useRootNavigationState, useRouter } from "expo-router";
import useAppSettings, { useSettings } from "@/lib/settings";
import { nativeFcmConfigured, requestNativePushToken } from "@/lib/nativePush";
import { notificationDestination } from "@/lib/notificationRouting";
import { useTRPCClient } from "@karakeep/shared-react/trpc";

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const { settings } = useSettings.getState().settings;
    const show =
      !!settings.apiKey &&
      !!settings.pushNotificationsEnabled &&
      !!notificationDestination(
        notification.request.content.data,
        settings.apiKeyId,
      );
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: show,
      shouldSetBadge: false,
    };
  },
});

export default function PushNotifications() {
  const { settings } = useAppSettings();
  const client = useTRPCClient();
  const router = useRouter();
  const navigation = useRootNavigationState();
  useEffect(() => {
    if (
      !nativeFcmConfigured() ||
      !settings.apiKey ||
      !settings.apiKeyId ||
      !settings.pushNotificationsEnabled ||
      !navigation?.key
    )
      return;
    let active = true;
    let registering = false;
    const register = async (token?: string) => {
      if (registering || !active) return;
      registering = true;
      try {
        const nativeToken = token ?? (await requestNativePushToken(false));
        if (active)
          await client.capture.registerDevice.mutate({
            token: nativeToken,
            scope: settings.apiKeyId!,
          });
      } catch {
        /* Retry on the next foreground transition; never log tokens. */
      } finally {
        registering = false;
      }
    };
    const navigate = (response: Notifications.NotificationResponse) => {
      if (!active) return;
      const current = useSettings.getState().settings.settings;
      if (!current.apiKey || current.apiKeyId !== settings.apiKeyId) return;
      const destination = notificationDestination(
        response.notification.request.content.data,
        current.apiKeyId,
      );
      if (destination) {
        router.push(destination);
        void Notifications.clearLastNotificationResponseAsync().catch(
          () => undefined,
        );
      }
    };
    void register();
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) navigate(response);
      })
      .catch(() => undefined);
    const token = Notifications.addPushTokenListener(
      (token) => void register(String(token.data)),
    );
    const response =
      Notifications.addNotificationResponseReceivedListener(navigate);
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void register();
    });
    return () => {
      active = false;
      token.remove();
      response.remove();
      foreground.remove();
    };
  }, [
    client,
    router,
    navigation?.key,
    settings.apiKey,
    settings.apiKeyId,
    settings.address,
    settings.pushNotificationsEnabled,
  ]);
  return null;
}
