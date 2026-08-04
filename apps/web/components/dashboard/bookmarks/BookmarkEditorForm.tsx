import type { SubmitErrorHandler, SubmitHandler } from "react-hook-form";
import React, { useImperativeHandle, useRef } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormItem } from "@/components/ui/form";
import { Kbd } from "@/components/ui/kbd";
import MultipleChoiceDialog from "@/components/ui/multiple-choice-dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import BookmarkSavedToast from "@/components/utils/BookmarkSavedToast";
import { useClientConfig } from "@/lib/clientConfig";
import { useTranslation } from "@/lib/i18n/client";
import { useBookmarkLayout } from "@/lib/userLocalSettings/bookmarksLayout";
import { cn, getOS } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { useHotkeys } from "react-hotkeys-hook";
import { z } from "zod";

import { useCreateBookmarkWithPostHook } from "@karakeep/shared-react/hooks/bookmarks";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import { BookmarkListSelector } from "../lists/BookmarkListSelector";
import { useUploadAsset } from "../UploadDropzone";

interface MultiUrlImportState {
  urls: URL[];
  text: string;
}

interface BookmarkEditorFormProps {
  className?: string;
  textareaClassName?: string;
  showHeader?: boolean;
  showListSelector?: boolean;
  compact?: boolean;
  onSaved?: () => void;
}

export default function BookmarkEditorForm({
  className,
  textareaClassName,
  showHeader = false,
  showListSelector = false,
  compact = false,
  onSaved,
}: BookmarkEditorFormProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [selectedListId, setSelectedListId] = React.useState<string | null>(
    null,
  );

  const [multiUrlImportState, setMultiUrlImportState] =
    React.useState<MultiUrlImportState | null>(null);

  const demoMode = !!useClientConfig().demoMode;
  const bookmarkLayout = useBookmarkLayout();
  const formSchema = z.object({
    text: z.string(),
  });
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      text: "",
    },
  });
  const { ref, ...textFieldProps } = form.register("text");
  useImperativeHandle(ref, () => inputRef.current);
  useHotkeys("mod+e", () => {
    inputRef.current?.focus();
  });

  const resetForm = () => {
    setSelectedListId(null);
    form.reset();
    if (bookmarkLayout === "list" && inputRef?.current?.style) {
      inputRef.current.style.height = "auto";
    }
  };

  const { mutate, isPending } = useCreateBookmarkWithPostHook(
    {
      onSuccess: (resp) => {
        if (resp.alreadyExists) {
          toast({
            description: <BookmarkSavedToast bookmarkId={resp.id} />,
            variant: "default",
          });
        }
        resetForm();
        onSaved?.();
      },
      onError: (e) => {
        toast({ description: e.message, variant: "destructive" });
      },
    },
    { listId: selectedListId },
  );

  const uploadAsset = useUploadAsset();

  function tryToImportUrls(text: string): void {
    const lines = text.split("\n");
    const urls: URL[] = [];
    for (const line of lines) {
      const url = new URL(line);
      if (url.protocol != "http:" && url.protocol != "https:") {
        throw new Error("Invalid URL");
      }
      urls.push(url);
    }

    if (urls.length === 1) {
      mutate({ type: BookmarkTypes.LINK, url: text });
      return;
    }
    setMultiUrlImportState({ urls, text });
  }

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (bookmarkLayout === "list" && !compact) {
      const target = e.target as HTMLTextAreaElement;
      const maxHeight = window.innerHeight * 0.5;
      target.style.height = "auto";

      if (target.scrollHeight <= maxHeight) {
        target.style.height = `${target.scrollHeight}px`;
      } else {
        target.style.height = `${maxHeight}px`;
      }
    }
  };

  const onSubmit: SubmitHandler<z.infer<typeof formSchema>> = (data) => {
    const text = data.text.trim();
    if (!text.length) return;
    try {
      tryToImportUrls(text);
    } catch {
      mutate({ type: BookmarkTypes.TEXT, text });
    }
  };

  const onError: SubmitErrorHandler<z.infer<typeof formSchema>> = (errors) => {
    toast({
      description: Object.values(errors)
        .map((v) => v.message)
        .join("\n"),
      variant: "destructive",
    });
  };

  const handlePaste = async (
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event?.clipboardData?.items) {
      await Promise.all(
        Array.from(event.clipboardData.items)
          .filter((item) => item?.type?.startsWith("image"))
          .map((item) => {
            const blob = item.getAsFile();
            if (blob) {
              return uploadAsset(blob);
            }
          }),
      );
    }
  };

  const handleNewTodo = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const todoMarkup = "- [ ] ";
    const textarea = inputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const textBefore = textarea.value.slice(0, start);
    const lines = textBefore.split("\n");
    const currentLine = lines[lines.length - 1];
    const currentLineIsTodo = currentLine.startsWith(todoMarkup);
    if (!currentLineIsTodo) return;
    e.preventDefault();
    const newValue =
      textarea.value.slice(0, start) +
      "\n" +
      todoMarkup +
      textarea.value.slice(end);
    form.setValue("text", newValue, { shouldDirty: true, shouldTouch: true });
    textarea.value = newValue;
    textarea.selectionStart = start + todoMarkup.length + 1;
    textarea.selectionEnd = start + todoMarkup.length + 1;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const OS = getOS();

  return (
    <Form {...form}>
      <form
        className={cn("relative flex flex-col gap-3", className)}
        onSubmit={form.handleSubmit(onSubmit, onError)}
      >
        {showHeader && (
          <>
            <div className="flex justify-between">
              <p className="text-sm">{t("editor.new_item")}</p>
              <Kbd>⌘ + E</Kbd>
            </div>
            <Separator />
          </>
        )}
        <FormItem className={cn("flex-1", compact && "min-h-28")}>
          <FormControl>
            <Textarea
              ref={inputRef}
              disabled={isPending}
              className={cn(
                "text-md h-full w-full font-light",
                compact
                  ? "min-h-28 resize-none"
                  : "border-none p-0 focus-visible:ring-0",
                { "resize-none": bookmarkLayout !== "list" || compact },
                textareaClassName,
              )}
              placeholder={t("editor.placeholder_v2")}
              onKeyDown={(e) => {
                if (demoMode) {
                  return;
                }
                if (
                  e.key === "Enter" &&
                  !(e.metaKey || e.ctrlKey || e.shiftKey)
                ) {
                  handleNewTodo(e);
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  form.handleSubmit(onSubmit, onError)();
                }
              }}
              onPaste={(e) => {
                if (demoMode) {
                  return;
                }
                handlePaste(e);
              }}
              onInput={onInput}
              {...textFieldProps}
            />
          </FormControl>
        </FormItem>
        {showListSelector && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Save to list</span>
            <div className="flex gap-2">
              <BookmarkListSelector
                value={selectedListId}
                onChange={setSelectedListId}
                placeholder="Unclassified"
                listTypes={["manual"]}
                disabled={isPending}
                displayMode="tree"
              />
              {selectedListId && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={isPending}
                  onClick={() => setSelectedListId(null)}
                  aria-label="Save without list"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          </div>
        )}
        <ActionButton
          disabled={!form.formState.dirtyFields.text}
          loading={isPending}
          type="submit"
          variant="secondary"
        >
          {form.formState.dirtyFields.text
            ? demoMode
              ? t("editor.disabled_submissions")
              : `${t("actions.save")} (${OS === "macos" ? "⌘" : "Ctrl"} + Enter)`
            : t("actions.save")}
        </ActionButton>

        {multiUrlImportState && (
          <MultipleChoiceDialog
            open={true}
            title={t("editor.multiple_urls_dialog_title")}
            description={t("editor.multiple_urls_dialog_desc")}
            onOpenChange={(open) => {
              if (!open) {
                setMultiUrlImportState(null);
              }
            }}
            actionButtons={[
              () => (
                <ActionButton
                  type="button"
                  variant="secondary"
                  loading={isPending}
                  onClick={() => {
                    mutate({
                      type: BookmarkTypes.TEXT,
                      text: multiUrlImportState.text,
                    });
                    setMultiUrlImportState(null);
                  }}
                >
                  {t("editor.import_as_text")}
                </ActionButton>
              ),
              () => (
                <ActionButton
                  type="button"
                  variant="destructive"
                  loading={isPending}
                  onClick={() => {
                    multiUrlImportState.urls.forEach((url) =>
                      mutate({ type: BookmarkTypes.LINK, url: url.toString() }),
                    );
                    setMultiUrlImportState(null);
                  }}
                >
                  {t("editor.import_as_separate_bookmarks")}
                </ActionButton>
              ),
            ]}
          ></MultipleChoiceDialog>
        )}
      </form>
    </Form>
  );
}
