import { useState } from "react";
import { Alert } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  SettingsActionRow,
  SettingsGroup,
  SettingsScreen,
  SettingsToggleRow,
  SettingsValueRow,
} from "@/components/settings/settings-list";
import {
  disableNativePush,
  nativeFcmConfigured,
  requestNativePushToken,
} from "@/lib/nativePush";
import useAppSettings from "@/lib/settings";
import { useTRPC } from "@karakeep/shared-react/trpc";

export default function NotificationSettings() {
  const api = useTRPC();
  const { settings, setSettings } = useAppSettings();
  const [busy, setBusy] = useState(false);
  const [testEvent, setTestEvent] = useState<number | null>(null);
  const status = useQuery(api.capture.pushStatus.queryOptions());
  const registration = useMutation(
    api.capture.registerDevice.mutationOptions(),
  );
  const unregister = useMutation(
    api.capture.unregisterDevice.mutationOptions(),
  );
  const test = useMutation(api.capture.testPush.mutationOptions());
  const delivery = useQuery({
    ...api.capture.deliveries.queryOptions({ eventId: testEvent ?? 1 }),
    enabled: testEvent !== null,
    refetchInterval: (query) =>
      testEvent &&
      (!query.state.data?.length ||
        query.state.data.some(
          (row) => row.state === "pending" || row.state === "sending",
        ))
        ? 5000
        : false,
  });
  const toggle = async (enabled: boolean) => {
    if (!settings.apiKeyId) return;
    setBusy(true);
    try {
      if (enabled) {
        const token = await requestNativePushToken(true);
        await registration.mutateAsync({ token, scope: settings.apiKeyId });
        await setSettings({ ...settings, pushNotificationsEnabled: true });
      } else {
        await setSettings({ ...settings, pushNotificationsEnabled: false });
        const results = await Promise.allSettled([
          disableNativePush(),
          unregister.mutateAsync({ scope: settings.apiKeyId }),
        ]);
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
      }
      await status.refetch();
    } catch (error) {
      Alert.alert(
        "Notifications",
        error instanceof Error
          ? error.message
          : "Unable to update push settings",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsScreen>
      <SettingsGroup>
        <SettingsValueRow
          label="APK Firebase configuration"
          value={nativeFcmConfigured() ? "Available" : "Not configured"}
        />
        <SettingsValueRow
          label="Server FCM"
          value={
            status.isError
              ? "Unavailable"
              : status.data?.configured
                ? "Configured"
                : "Not configured"
          }
        />
        <SettingsToggleRow
          label="Capture notifications"
          value={!!settings.pushNotificationsEnabled}
          disabled={
            busy ||
            !nativeFcmConfigured() ||
            (!settings.pushNotificationsEnabled && !status.data?.configured)
          }
          onValueChange={(value) => void toggle(value)}
        />
        <SettingsActionRow
          label="Send test notification"
          tone="default"
          disabled={
            !settings.pushNotificationsEnabled ||
            !status.data?.configured ||
            busy
          }
          isLoading={test.isPending}
          onPress={() => {
            if (settings.apiKeyId)
              test.mutate(
                { scope: settings.apiKeyId },
                {
                  onSuccess: (result) => setTestEvent(result.eventId),
                  onError: (error) =>
                    Alert.alert("Notifications", error.message),
                },
              );
          }}
        />
        {testEvent && (
          <SettingsValueRow
            label="Last test delivery"
            value={
              delivery.data
                ?.map((row) =>
                  row.lastError ? `${row.state}: ${row.lastError}` : row.state,
                )
                .join(", ") || "Queued"
            }
          />
        )}
      </SettingsGroup>
    </SettingsScreen>
  );
}
