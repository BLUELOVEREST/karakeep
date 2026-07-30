import { useRef, useState } from "react";
import { Platform, PlatformColor, View } from "react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { BookmarkListPickerModal } from "@/components/bookmarks/BookmarkListPicker";
import BookmarkListHeader from "@/components/bookmarks/BookmarkListHeader";
import UpdatingBookmarkList from "@/components/bookmarks/UpdatingBookmarkList";
import InlineSearch from "@/components/search/InlineSearch";
import { ProfileAvatarButton } from "@/components/settings/ProfileAvatarButton";
import AndroidSearchBar from "@/components/ui/AndroidSearchBar";
import { FAB } from "@/components/ui/FAB";
import useAppSettings from "@/lib/settings";
import { useUploadAsset } from "@/lib/upload";
import { useMenuIconColors } from "@/lib/useMenuIconColors";
import { MenuView } from "@react-native-menu/menu";
import { Plus } from "lucide-react-native";
import { toast as sonnerToast } from "sonner-native";
import { useCreateBookmark } from "@karakeep/shared-react/hooks/bookmarks";
import { useAddBookmarkToList } from "@karakeep/shared-react/hooks/lists";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

function useNewBookmarkActions() {
  const { settings } = useAppSettings();
  const { menuIconColor } = useMenuIconColors();
  const uploadToastIdRef = useRef<string | number | null>(null);
  const createBookmark = useCreateBookmark();
  const { mutate: addToList } = useAddBookmarkToList();

  const { uploadAsset } = useUploadAsset(settings, {
    onSuccess: () => {
      if (uploadToastIdRef.current !== null) {
        sonnerToast.success("Image saved!", { id: uploadToastIdRef.current });
        uploadToastIdRef.current = null;
      }
    },
    onError: (e) => {
      if (uploadToastIdRef.current !== null) {
        sonnerToast.error(e, { id: uploadToastIdRef.current });
        uploadToastIdRef.current = null;
      } else {
        sonnerToast.error(e);
      }
    },
  });

  const runAction = async (event: string, listId: string | null) => {
    Haptics.selectionAsync();
    if (event === "new") {
      router.push({
        pathname: "/dashboard/bookmarks/new",
        params: listId ? { listId } : undefined,
      });
    } else if (event === "library") {
      try {
        uploadToastIdRef.current = sonnerToast.loading(
          "Opening photo library...",
        );
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: settings.imageQuality,
          allowsMultipleSelection: false,
        });
        if (!result.canceled) {
          const asset = result.assets[0];
          if (!asset) {
            sonnerToast.dismiss(uploadToastIdRef.current);
            uploadToastIdRef.current = null;
            return;
          }
          sonnerToast.loading("Uploading image...", {
            id: uploadToastIdRef.current,
          });
          uploadAsset({
            type: asset.mimeType ?? "",
            name: asset.fileName ?? "",
            uri: asset.uri,
            listId,
          });
        } else {
          sonnerToast.dismiss(uploadToastIdRef.current);
          uploadToastIdRef.current = null;
        }
      } catch {
        if (uploadToastIdRef.current !== null) {
          sonnerToast.error("Failed to open photo library", {
            id: uploadToastIdRef.current,
          });
          uploadToastIdRef.current = null;
        } else {
          sonnerToast.error("Failed to open photo library");
        }
      }
    } else if (event === "clipboard") {
      if (createBookmark.isPending) return;

      const toastId = sonnerToast.loading("Reading clipboard...");
      try {
        const contents = (await Clipboard.getStringAsync()).trim();
        if (!contents) {
          sonnerToast.error("Clipboard is empty", { id: toastId });
          return;
        }

        let isUrl = false;
        try {
          const parsed = new URL(contents);
          if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            isUrl = true;
            sonnerToast.loading("Saving URL...", { id: toastId });
          }
        } catch {
          // not a valid URL — treat as text
          sonnerToast.loading("Saving text...", { id: toastId });
        }

        const resp = await (isUrl
          ? createBookmark.mutateAsync({
              type: BookmarkTypes.LINK,
              url: new URL(contents).toString(),
              source: "mobile",
            })
          : createBookmark.mutateAsync({
              type: BookmarkTypes.TEXT,
              text: contents,
              source: "mobile",
            }));
        if (listId) {
          addToList({ bookmarkId: resp.id, listId });
        }
        sonnerToast.success(resp.alreadyExists ? "Already exists" : "Saved!", {
          id: toastId,
        });
      } catch (e) {
        sonnerToast.error(
          e instanceof Error ? e.message : "Failed to save from clipboard",
          { id: toastId },
        );
      }
    }
  };

  const actions = [
    {
      id: "clipboard",
      title: "Clipboard",
      image: Platform.select({ ios: "clipboard" }),
      imageColor: Platform.select({ ios: menuIconColor }),
    },
    {
      id: "new",
      title: "New Bookmark",
      image: Platform.select({ ios: "square.and.pencil" }),
      imageColor: Platform.select({ ios: menuIconColor }),
    },
    {
      id: "library",
      title: "Photo Library",
      image: Platform.select({ ios: "photo" }),
      imageColor: Platform.select({ ios: menuIconColor }),
    },
  ];

  return { runAction, actions };
}

export default function Home() {
  const [searchActive, setSearchActive] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const { runAction, actions } = useNewBookmarkActions();

  if (Platform.OS === "android" && searchActive) {
    return <InlineSearch onClose={() => setSearchActive(false)} />;
  }

  return (
    <>
      {Platform.OS === "android" && (
        <AndroidSearchBar
          label="Search bookmarks..."
          onPress={() => setSearchActive(true)}
          rightElement={<ProfileAvatarButton />}
          trailingElement={<BookmarkListHeader />}
        />
      )}
      <UpdatingBookmarkList query={{ archived: false }} />
      <FAB>
        <MenuView
          onPressAction={({ nativeEvent }) => {
            setPendingAction(nativeEvent.event);
            setPickerOpen(true);
          }}
          actions={actions}
          shouldOpenOnLongPress={false}
        >
          <View className="h-full w-full items-center justify-center">
            <Plus
              size={24}
              color={Platform.OS === "ios" ? PlatformColor("label") : "white"}
            />
          </View>
        </MenuView>
      </FAB>
      <BookmarkListPickerModal
        label="Save to"
        value={null}
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) {
            setPendingAction(null);
          }
        }}
        onChange={(listId) => {
          if (pendingAction) {
            void runAction(pendingAction, listId);
          }
          setPendingAction(null);
        }}
      />
    </>
  );
}
