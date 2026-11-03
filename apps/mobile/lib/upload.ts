import ReactNativeBlobUtil from "react-native-blob-util";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";
import { BookmarkTypes, ZBookmark } from "@karakeep/shared/types/bookmarks";
import {
  zUploadErrorSchema,
  zUploadResponseSchema,
} from "@karakeep/shared/types/uploads";
import { useAddBookmarkToList } from "@karakeep/shared-react/hooks/lists";

import type { Settings } from "./settings";
import { buildApiHeaders } from "./utils";

// Not every failure has an `{ error }` body: unhandled server errors are plain
// text, and auth/validation/rate-limit failures use other shapes.
function getUploadErrorMessage(status: number, body: string): string {
  try {
    const parsed = zUploadErrorSchema.safeParse(JSON.parse(body));
    if (parsed.success) {
      return parsed.data.error;
    }
  } catch {
    // Not JSON
  }
  return `Upload failed (HTTP ${status})`;
}

export function useUploadAsset(
  settings: Settings,
  options: {
    onSuccess?: (bookmark: ZBookmark & { alreadyExists: boolean }) => void;
    onError?: (e: string) => void;
  },
) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { mutateAsync: addToList } = useAddBookmarkToList();

  const { mutateAsync: createBookmark } = useMutation(
    api.bookmarks.createBookmark.mutationOptions(),
  );

  const { mutate: uploadAsset, isPending: isUploading } = useMutation({
    mutationFn: async (file: {
      type: string;
      name: string;
      uri: string;
      listId?: string | null;
    }) => {
      // There's a bug in the native FormData implementation (https://github.com/facebook/react-native/issues/44737)
      // that will only get fixed in react native 0.77. Using the BlobUtil implementation for now.
      const resp = await ReactNativeBlobUtil.fetch(
        "POST",
        `${settings.address}/api/assets`,
        {
          ...buildApiHeaders(settings.apiKey, settings.customHeaders),
          "Content-Type": "multipart/form-data",
        },
        [
          {
            name: "file",
            filename: file.name,
            type: file.type,
            data: ReactNativeBlobUtil.wrap(file.uri.replace("file://", "")),
          },
        ],
      );
      const status = resp.info().status;
      const body: string = await resp.text();
      if (status < 200 || status >= 300) {
        throw new Error(getUploadErrorMessage(status, body));
      }
      let uploaded;
      try {
        uploaded = zUploadResponseSchema.parse(JSON.parse(body));
      } catch {
        // e.g. a proxy or captive portal answering with an HTML page
        throw new Error(`Unexpected server response (HTTP ${status})`);
      }
      const assetId = uploaded.assetId;
      const assetType =
        uploaded.contentType === "application/pdf" ? "pdf" : "image";
      const bookmark = await createBookmark({
        type: BookmarkTypes.ASSET,
        assetId,
        assetType,
        source: "mobile",
      });
      if (file.listId) {
        await addToList({ bookmarkId: bookmark.id, listId: file.listId });
      }
      return bookmark;
    },
    onSuccess: (bookmark) => {
      queryClient.invalidateQueries(api.bookmarks.getBookmarks.pathFilter());
      options.onSuccess?.(bookmark);
    },
    onError: (e) => {
      options.onError?.(e.message);
    },
  });

  return {
    uploadAsset,
    isPending: isUploading,
  };
}
