import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { Button } from "@/components/ui/Button";
import { RowSeparator } from "@/components/ui/GroupedList";
import { Text } from "@/components/ui/Text";
import { useColorScheme } from "@/lib/useColorScheme";
import { Check, ChevronDown, ChevronRight, Folder } from "lucide-react-native";

import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import {
  filterAssignableListPaths,
  listNameFromPath,
  listTreeRowsFromPaths,
} from "@karakeep/shared/utils/listUtils";

interface BookmarkListPickerProps {
  value?: string | null;
  onChange: (listId: string | null) => void;
  label?: string;
  disabled?: boolean;
  hideIds?: string[];
}

interface BookmarkListPickerModalProps extends BookmarkListPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BookmarkListPickerModal({
  value,
  onChange,
  label = "Save to",
  hideIds,
  open,
  onOpenChange,
}: BookmarkListPickerModalProps) {
  const { colors } = useColorScheme();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const { data, isPending } = useBookmarkLists(undefined, { enabled: open });

  const allPaths = useMemo(
    () =>
      data?.allPaths
        ? filterAssignableListPaths(data.allPaths, { hideIds })
        : undefined,
    [data?.allPaths, hideIds],
  );

  const rows = useMemo(
    () => (allPaths ? listTreeRowsFromPaths(allPaths, expandedIds) : undefined),
    [allPaths, expandedIds],
  );

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

  const selectList = (listId: string | null) => {
    onChange(listId);
    onOpenChange(false);
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={open}
      onRequestClose={() => onOpenChange(false)}
    >
      <View className="flex-1 bg-background">
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <Text className="text-lg font-semibold">{label}</Text>
          <Button variant="plain" size="sm" onPress={() => onOpenChange(false)}>
            <Text>Close</Text>
          </Button>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View
            className="overflow-hidden rounded-xl bg-card"
            style={{ borderCurve: "continuous" }}
          >
            <Pressable
              onPress={() => selectList(null)}
              className="flex-row items-center justify-between px-4 py-3 active:opacity-70"
            >
              <View className="min-w-0 flex-1 flex-row items-center gap-3">
                <View className="w-6 items-center">
                  <Folder size={18} color={colors.grey} />
                </View>
                <Text className="min-w-0 flex-1" numberOfLines={1}>
                  Uncategorized
                </Text>
              </View>
              {!value && (
                <Check size={20} color={colors.primary} strokeWidth={2.5} />
              )}
            </Pressable>

            <RowSeparator />

            {isPending ? (
              <View className="items-center py-8">
                <ActivityIndicator />
              </View>
            ) : rows && rows.length > 0 ? (
              rows.map((row, index) => {
                const isSelected = value === row.id;
                const isExpanded = expandedIds.has(row.id);

                return (
                  <React.Fragment key={row.id}>
                    {index > 0 && <RowSeparator />}
                    <Pressable
                      onPress={() => selectList(row.id)}
                      className="flex-row items-center justify-between py-3 pr-4 active:opacity-70"
                      style={{ paddingLeft: 16 + row.depth * 18 }}
                    >
                      <View className="min-w-0 flex-1 flex-row items-center gap-3">
                        <Pressable
                          disabled={!row.hasChildren}
                          onPress={(event) => {
                            event.stopPropagation();
                            toggleExpanded(row.id);
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
                        <Text className="min-w-0 flex-1" numberOfLines={1}>
                          {row.item.icon} {row.item.name}
                        </Text>
                      </View>
                      {isSelected && (
                        <Check
                          size={20}
                          color={colors.primary}
                          strokeWidth={2.5}
                        />
                      )}
                    </Pressable>
                  </React.Fragment>
                );
              })
            ) : (
              <View className="items-center py-8">
                <Text color="tertiary">No lists available</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function BookmarkListPicker({
  value,
  onChange,
  label = "Save to",
  disabled,
  hideIds,
}: BookmarkListPickerProps) {
  const { colors } = useColorScheme();
  const [open, setOpen] = useState(false);
  const { data } = useBookmarkLists(undefined, { enabled: Boolean(value) });
  const selectedPath = value ? data?.getPathById(value) : undefined;
  const selectedLabel = selectedPath
    ? listNameFromPath(selectedPath)
    : "Uncategorized";

  return (
    <>
      <View className="gap-1.5">
        <Text className="text-base">{label}</Text>
        <Pressable
          disabled={disabled}
          onPress={() => setOpen(true)}
          className="min-h-11 flex-row items-center justify-between rounded-lg border border-input bg-card px-4 py-2.5 active:opacity-70"
        >
          <Text className="min-w-0 flex-1 pr-3" numberOfLines={1}>
            {selectedLabel}
          </Text>
          <ChevronRight size={18} color={colors.grey} />
        </Pressable>
      </View>
      <BookmarkListPickerModal
        value={value}
        onChange={onChange}
        label={label}
        hideIds={hideIds}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
