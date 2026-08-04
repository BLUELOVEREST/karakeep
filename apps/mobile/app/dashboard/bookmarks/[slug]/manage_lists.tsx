import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import QueryPageState from "@/components/QueryPageState";
import { RowSeparator } from "@/components/ui/GroupedList";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { useColorScheme } from "@/lib/useColorScheme";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight } from "lucide-react-native";
import { useHeaderHeight } from "expo-router/react-navigation";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import {
  filterAssignableListPaths,
  listTreeRowsFromPaths,
} from "@karakeep/shared/utils/listUtils";
import {
  useAddBookmarkToList,
  useBookmarkLists,
  useRemoveBookmarkFromList,
} from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";

const ListPickerPage = () => {
  const headerHeight = useHeaderHeight();
  const api = useTRPC();
  const { slug: bookmarkId } = useLocalSearchParams();
  const { colors } = useColorScheme();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  if (typeof bookmarkId !== "string") {
    throw new Error("Unexpected param type");
  }

  const { toast } = useToast();
  const onError = () => {
    toast({
      message: "Something went wrong",
      variant: "destructive",
      showProgress: false,
    });
  };

  const {
    data: existingLists,
    error: existingListsError,
    refetch: refetchExistingLists,
  } = useQuery(
    api.lists.getListsOfBookmark.queryOptions(
      { bookmarkId },
      {
        select: (data: { lists: ZBookmarkList[] }) =>
          new Set(data.lists.map((l) => l.id)),
      },
    ),
  );

  const { data, error: listsError, refetch: refetchLists } = useBookmarkLists();

  const {
    mutate: addToList,
    isPending: isAddingToList,
    variables: addVariables,
  } = useAddBookmarkToList({
    onError,
  });

  const {
    mutate: removeToList,
    isPending: isRemovingFromList,
    variables: removeVariables,
  } = useRemoveBookmarkFromList({
    onError,
  });

  const toggleList = (listId: string) => {
    if (!existingLists) return;
    if (existingLists.has(listId)) {
      removeToList({ bookmarkId, listId });
    } else {
      addToList({ bookmarkId, listId });
    }
  };

  const isListLoading = (listId: string) => {
    return (
      (isAddingToList && addVariables?.listId === listId) ||
      (isRemovingFromList && removeVariables?.listId === listId)
    );
  };

  const rows = useMemo(() => {
    if (!data?.allPaths) {
      return undefined;
    }
    return listTreeRowsFromPaths(
      filterAssignableListPaths(data.allPaths),
      expandedIds,
    );
  }, [data?.allPaths, expandedIds]);

  const toggleExpanded = (listId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(listId)) {
        next.delete(listId);
      } else {
        next.add(listId);
      }
      return next;
    });
  };

  if (!existingLists || !data) {
    return (
      <QueryPageState
        error={existingListsError ?? listsError}
        onRetry={() => {
          void refetchExistingLists();
          void refetchLists();
        }}
      />
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: false,
          headerTitle: "Manage Lists",
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 40 + headerHeight,
        }}
        className="flex-1 bg-background"
      >
        {rows && rows.length > 0 ? (
          <View
            className="overflow-hidden rounded-xl bg-card"
            style={{ borderCurve: "continuous" }}
          >
            {rows.map((row, index) => {
              const listId = row.id;
              const isLoading = isListLoading(listId);
              const isChecked = existingLists?.has(listId);
              const isExpanded = expandedIds.has(listId);

              return (
                <React.Fragment key={listId}>
                  {index > 0 && <RowSeparator />}
                  <Pressable
                    onPress={() => !isLoading && toggleList(listId)}
                    disabled={isLoading}
                    className="flex-row items-center justify-between py-3 pr-4 active:opacity-70"
                    style={{ paddingLeft: 16 + row.depth * 18 }}
                  >
                    <View className="min-w-0 flex-1 flex-row items-center gap-3">
                      <Pressable
                        disabled={!row.hasChildren}
                        onPress={(event) => {
                          event.stopPropagation();
                          toggleExpanded(listId);
                        }}
                        className="h-7 w-7 items-center justify-center"
                      >
                        {row.hasChildren ? (
                          isExpanded ? (
                            <ChevronDown size={18} color={colors.grey} />
                          ) : (
                            <ChevronRight size={18} color={colors.grey} />
                          )
                        ) : (
                          <View className="h-7 w-7" />
                        )}
                      </Pressable>
                      <Text className="min-w-0 flex-1 pr-3" numberOfLines={1}>
                        {row.item.icon} {row.item.name}
                      </Text>
                    </View>
                    {isLoading ? (
                      <ActivityIndicator size="small" />
                    ) : isChecked ? (
                      <Check
                        size={20}
                        color={colors.primary}
                        strokeWidth={2.5}
                      />
                    ) : null}
                  </Pressable>
                </React.Fragment>
              );
            })}
          </View>
        ) : (
          <View className="items-center py-12">
            <Text color="tertiary">No lists available</Text>
          </View>
        )}
      </ScrollView>
    </>
  );
};

export default ListPickerPage;
