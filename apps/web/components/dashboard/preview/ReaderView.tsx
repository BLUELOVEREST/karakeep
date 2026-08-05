import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { toast } from "@/components/ui/sonner";
import { useTranslation } from "@/lib/i18n/client";
import { useQuery } from "@tanstack/react-query";
import { FileX } from "lucide-react";

import BookmarkHTMLHighlighter from "@karakeep/shared-react/components/BookmarkHtmlHighlighter";
import ScrollProgressTracker from "@karakeep/shared-react/components/ScrollProgressTracker";
import {
  useCreateHighlight,
  useDeleteHighlight,
  useUpdateHighlight,
} from "@karakeep/shared-react/hooks/highlights";
import { useReadingProgress } from "@karakeep/shared-react/hooks/reading-progress";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import ReadingProgressBanner from "./ReadingProgressBanner";

const readerDarkModeStyles = `
  .dark .karakeep-web-reader-content,
  .dark .karakeep-web-reader-content .prose {
    color: hsl(var(--foreground)) !important;
    color-scheme: dark;
    --tw-prose-body: hsl(var(--foreground));
    --tw-prose-headings: hsl(var(--foreground));
    --tw-prose-lead: hsl(var(--muted-foreground));
    --tw-prose-links: hsl(var(--primary));
    --tw-prose-bold: hsl(var(--foreground));
    --tw-prose-counters: hsl(var(--muted-foreground));
    --tw-prose-bullets: hsl(var(--muted-foreground));
    --tw-prose-hr: hsl(var(--border));
    --tw-prose-quotes: hsl(var(--foreground));
    --tw-prose-quote-borders: hsl(var(--border));
    --tw-prose-captions: hsl(var(--muted-foreground));
    --tw-prose-code: hsl(var(--foreground));
    --tw-prose-pre-code: hsl(var(--foreground));
    --tw-prose-pre-bg: hsl(var(--muted));
    --tw-prose-th-borders: hsl(var(--border));
    --tw-prose-td-borders: hsl(var(--border));
  }

  .dark .karakeep-web-reader-content .prose :where(
    article,
    section,
    div,
    p,
    span,
    li,
    ul,
    ol,
    table,
    thead,
    tbody,
    tr,
    td,
    th,
    blockquote,
    figcaption,
    label,
    small,
    strong,
    em,
    b,
    i,
    u
  )[style*="color" i] {
    color: hsl(var(--foreground)) !important;
  }

  .dark .karakeep-web-reader-content .prose :is(h1, h2, h3, h4, h5, h6) {
    color: hsl(var(--foreground)) !important;
  }

  .dark .karakeep-web-reader-content .prose :is(pre, code) {
    border-color: hsl(var(--border)) !important;
  }

  .dark .karakeep-web-reader-content .prose pre {
    color: hsl(var(--foreground)) !important;
    background: hsl(var(--muted)) !important;
  }

  .dark .karakeep-web-reader-content .prose :not(pre) > code {
    color: hsl(var(--foreground)) !important;
    background: hsl(var(--muted)) !important;
  }

  .dark .karakeep-web-reader-content .prose hr,
  .dark .karakeep-web-reader-content .prose [style*="border-color: rgba(0,0,0" i],
  .dark .karakeep-web-reader-content .prose [style*="border-color: rgba(0, 0, 0" i] {
    border-color: hsl(var(--border)) !important;
  }

  .dark .karakeep-web-reader-content .prose a,
  .dark .karakeep-web-reader-content .prose a[style*="color" i] {
    color: hsl(var(--primary)) !important;
    text-decoration-color: hsl(var(--primary) / 0.5);
    text-underline-offset: 2px;
  }

  .dark .karakeep-web-reader-content .prose [data-highlight="true"] {
    color: hsl(var(--foreground)) !important;
  }
`;

export default function ReaderView({
  bookmarkId,
  className,
  style,
  readOnly,
  progressBarStyle,
}: {
  bookmarkId: string;
  className?: string;
  style?: React.CSSProperties;
  readOnly: boolean;
  progressBarStyle?: React.CSSProperties;
}) {
  const { t } = useTranslation();
  const api = useTRPC();
  const { data: highlights } = useQuery(
    api.highlights.getForBookmark.queryOptions({
      bookmarkId,
    }),
  );
  const { data: cachedContent, isPending: isCachedContentLoading } = useQuery(
    api.bookmarks.getBookmark.queryOptions(
      {
        bookmarkId,
        includeContent: true,
      },
      {
        select: (data) =>
          data.content.type == BookmarkTypes.LINK
            ? data.content.htmlContent
            : null,
      },
    ),
  );

  const {
    showBanner,
    bannerPercent,
    onContinue,
    onDismiss,
    restorePosition,
    readingProgressOffset,
    readingProgressAnchor,
    onSavePosition,
    onScrollPositionChange,
  } = useReadingProgress({
    bookmarkId,
  });

  const { mutate: createHighlight } = useCreateHighlight({
    onSuccess: () => {
      toast({
        description: "Highlight has been created!",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "Something went wrong",
      });
    },
  });

  const { mutate: updateHighlight } = useUpdateHighlight({
    onSuccess: () => {
      toast({
        description: "Highlight has been updated!",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "Something went wrong",
      });
    },
  });

  const { mutate: deleteHighlight } = useDeleteHighlight({
    onSuccess: () => {
      toast({
        description: "Highlight has been deleted!",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "Something went wrong",
      });
    },
  });

  let content;
  if (isCachedContentLoading) {
    content = <FullPageSpinner />;
  } else if (!cachedContent) {
    content = (
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="max-w-sm space-y-4 text-center">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <FileX className="h-8 w-8 text-muted-foreground" />
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-medium text-foreground">
              {t("preview.fetch_error_title")}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("preview.fetch_error_description")}
            </p>
          </div>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="karakeep-web-reader-content">
        <style>{readerDarkModeStyles}</style>
        <ScrollProgressTracker
          onSavePosition={onSavePosition}
          onScrollPositionChange={onScrollPositionChange}
          restorePosition={restorePosition}
          readingProgressOffset={readingProgressOffset}
          readingProgressAnchor={readingProgressAnchor}
          showProgressBar
          progressBarStyle={progressBarStyle}
        >
          {showBanner && (
            <ReadingProgressBanner
              percent={bannerPercent}
              onContinue={onContinue}
              onDismiss={onDismiss}
            />
          )}
          <BookmarkHTMLHighlighter
            className={className}
            style={style}
            htmlContent={cachedContent || ""}
            highlights={highlights?.highlights ?? []}
            readOnly={readOnly}
            onDeleteHighlight={(h) =>
              deleteHighlight({
                highlightId: h.id,
              })
            }
            onUpdateHighlight={(h) =>
              updateHighlight({
                highlightId: h.id,
                color: h.color,
                note: h.note,
              })
            }
            onHighlight={(h) =>
              createHighlight({
                startOffset: h.startOffset,
                endOffset: h.endOffset,
                color: h.color,
                bookmarkId,
                text: h.text,
                note: h.note ?? null,
              })
            }
          />
        </ScrollProgressTracker>
      </div>
    );
  }
  return content;
}
