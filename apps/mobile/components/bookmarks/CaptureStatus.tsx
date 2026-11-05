import { View } from "react-native";
import { RefreshCw } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { useColorScheme } from "@/lib/useColorScheme";
import { useCaptureStatus } from "@karakeep/shared-react/hooks/capture";
import { useRecrawlBookmark } from "@karakeep/shared-react/hooks/bookmarks";
import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { captureAdvice } from "@karakeep/shared/types/captureEvents";
import { captureErrorMessage } from "@karakeep/shared/types/captureErrorMessages";

export default function CaptureStatus({ bookmark }: { bookmark: ZBookmark }) {
  const { colors } = useColorScheme();
  const status = useCaptureStatus(
    bookmark.id,
    bookmark.content.type === "link" &&
      bookmark.content.crawlStatus === "pending",
  );
  const recrawl = useRecrawlBookmark({
    onSuccess: () => void status.refetch(),
  });
  if (bookmark.content.type !== "link") return null;
  const phase = status.data?.phase;
  const busy =
    bookmark.content.crawlStatus === "pending" ||
    ["running", "retrying", "awaiting_media"].includes(phase ?? "");
  const code =
    phase === "recovered"
      ? null
      : (status.data?.code ?? bookmark.content.crawlError?.code);
  if (!busy && !code && phase !== "recovered") return null;
  const title = busy
    ? phase === "retrying"
      ? "Retrying capture"
      : phase === "awaiting_media"
        ? "Saving media"
        : "Capture queued or running"
    : phase === "partial" ||
        bookmark.content.crawlError?.source === "reader_image_archive"
      ? "Partially completed"
      : phase === "recovered"
        ? "Capture recovered"
        : "Capture failed";
  const takingLong =
    busy &&
    status.data?.startedAt &&
    status.dataUpdatedAt - new Date(status.data.startedAt).getTime() > 180000;
  return (
    <View className="gap-2 border-b border-border bg-muted p-3">
      <Text className="font-semibold">{title}</Text>
      {takingLong && (
        <Text color="tertiary">
          Taking longer than usual; failure has not been confirmed.
        </Text>
      )}
      {!busy && code && (
        <>
          <Text>{captureErrorMessage(code)}</Text>
          <Text color="tertiary">{captureAdvice(code)}</Text>
        </>
      )}
      {!busy && code && (
        <Button
          variant="plain"
          disabled={recrawl.isPending}
          accessibilityLabel="Retry capture"
          onPress={() => recrawl.mutate({ bookmarkId: bookmark.id })}
        >
          <RefreshCw size={18} color={colors.foreground} />
          <Text>Retry capture</Text>
        </Button>
      )}
    </View>
  );
}
