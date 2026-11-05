import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SettingsScreen } from "@/components/settings/settings-list";
import { Text } from "@/components/ui/Text";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { captureAdvice } from "@karakeep/shared/types/captureEvents";

export default function CaptureEventHistory() {
  const api = useTRPC();
  const router = useRouter();
  const events = useQuery({
    ...api.capture.recent.queryOptions(),
    refetchInterval: 15000,
  });
  return (
    <SettingsScreen>
      {events.isError && (
        <Text color="tertiary">Unable to load capture events.</Text>
      )}
      {events.data?.length === 0 && (
        <Text color="tertiary">No capture events.</Text>
      )}
      {events.data?.map((event) => (
        <Pressable
          key={event.id}
          disabled={!event.bookmarkId}
          onPress={() => {
            if (event.bookmarkId)
              router.push({
                pathname: "/dashboard/bookmarks/[slug]",
                params: { slug: event.bookmarkId },
              });
          }}
          className="gap-2 border-b border-border py-3"
        >
          <View className="flex-row justify-between gap-2">
            <Text>{event.platform}</Text>
            <Text variant="footnote" color="tertiary">
              {event.type.replace("capture.", "")}
            </Text>
          </View>
          <Text>{event.message}</Text>
          {event.title && <Text className="font-semibold">{event.title}</Text>}
          {event.code && (
            <Text variant="footnote" color="tertiary">
              {captureAdvice(event.code)}
            </Text>
          )}
          <Text variant="footnote" color="tertiary">
            {new Date(event.createdAt).toLocaleString()}
          </Text>
        </Pressable>
      ))}
    </SettingsScreen>
  );
}
