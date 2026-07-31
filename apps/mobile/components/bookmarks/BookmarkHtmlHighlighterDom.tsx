"use dom";

import "@/globals.css";

import { useEffect } from "react";

import type { Highlight } from "@karakeep/shared-react/components/BookmarkHtmlHighlighter";
import BookmarkHTMLHighlighter from "@karakeep/shared-react/components/BookmarkHtmlHighlighter";
import ScrollProgressTracker from "@karakeep/shared-react/components/ScrollProgressTracker";

export default function BookmarkHtmlHighlighterDom({
  htmlContent,
  contentStyle,
  highlights,
  readOnly,
  onHighlight,
  onUpdateHighlight,
  onDeleteHighlight,
  onLinkPress,
  onImagePress,
  isDark,
  readingProgressOffset,
  readingProgressAnchor,
  restoreReadingPosition,
  onSavePosition,
  onScrollPositionChange,
}: {
  htmlContent: string;
  contentStyle?: React.CSSProperties;
  highlights?: Highlight[];
  readOnly?: boolean;
  onHighlight?: (highlight: Highlight) => void;
  onUpdateHighlight?: (highlight: Highlight) => void;
  onDeleteHighlight?: (highlight: Highlight) => void;
  onLinkPress?: (url: string) => void;
  onImagePress?: (src: string) => void;
  isDark?: boolean;
  readingProgressOffset?: number | null;
  readingProgressAnchor?: string | null;
  restoreReadingPosition?: boolean;
  onSavePosition?: (position: {
    offset: number;
    anchor: string;
    percent: number;
  }) => void;
  onScrollPositionChange?: (position: {
    offset: number;
    anchor: string;
    percent: number;
  }) => void;
  dom?: import("expo/dom").DOMProps;
}) {
  // Strip href from links so the browser treats them as regular selectable text
  // instead of activating native link gestures (iOS preview, Android drag).
  // The URL is preserved in data-href for our click handler.
  useEffect(() => {
    const stripHrefs = () => {
      document.querySelectorAll("a[href]").forEach((a) => {
        const anchor = a as HTMLAnchorElement;
        if (!anchor.dataset.href) {
          anchor.dataset.href = anchor.getAttribute("href")!;
          anchor.removeAttribute("href");
        }
      });
    };

    stripHrefs();

    // Re-strip if the DOM changes (e.g. highlight effects re-render content)
    const observer = new MutationObserver(stripHrefs);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  // Intercept link and image clicks to open them externally
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Don't intercept if the user is selecting text (for highlighting)
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        return;
      }

      // Check for link clicks (href is stored in data-href)
      const anchor = target.closest("a");
      const href = anchor?.dataset.href;
      if (href) {
        // Allow in-page anchor links
        if (href.startsWith("#")) {
          const targetEl = document.querySelector(href);
          if (targetEl) {
            targetEl.scrollIntoView();
          }
          return;
        }
        // Ignore javascript: URLs
        if (href.startsWith("javascript:")) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        onLinkPress?.(href);
        return;
      }

      // Check for image clicks
      const img = target.closest("img");
      if (img?.src) {
        e.preventDefault();
        onImagePress?.(img.src);
        return;
      }
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [onLinkPress, onImagePress]);

  useEffect(() => {
    const logImages = () => {
      const images = [...document.querySelectorAll("img")];
      console.info("[KarakeepImage] Reader DOM images", {
        count: images.length,
        sources: images.map((img) => ({
          src: img.currentSrc || img.src,
          attrSrc: img.getAttribute("src"),
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        })),
      });
    };

    const handleLoad = (event: Event) => {
      if (!(event.target instanceof HTMLImageElement)) {
        return;
      }
      const img = event.target as HTMLImageElement;
      console.info("[KarakeepImage] Reader DOM image loaded", {
        src: img.currentSrc || img.src,
        attrSrc: img.getAttribute("src"),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
    };

    const handleError = (event: Event) => {
      if (!(event.target instanceof HTMLImageElement)) {
        return;
      }
      const img = event.target as HTMLImageElement;
      console.warn("[KarakeepImage] Reader DOM image failed", {
        src: img.currentSrc || img.src,
        attrSrc: img.getAttribute("src"),
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
    };

    logImages();
    document.addEventListener("load", handleLoad, true);
    document.addEventListener("error", handleError, true);
    const observer = new MutationObserver(logImages);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("load", handleLoad, true);
      document.removeEventListener("error", handleError, true);
      observer.disconnect();
    };
  }, [htmlContent]);

  return (
    <div
      className={`karakeep-reader-content ${isDark ? "karakeep-reader-content-dark" : ""}`}
      style={{ maxWidth: "100vw", overflowX: "hidden" }}
    >
      <style>
        {`
          .karakeep-reader-content-dark :is(article, section, div, p, span, li, strong, em)[style*="color"] {
            color: #e5e7eb !important;
          }

          .karakeep-reader-content-dark [data-highlight="true"] {
            color: #f3f4f6 !important;
          }

          .feed-link-tag {
            display: inline-block;
            margin: 0 2px;
            padding: 2px 7px;
            border-radius: 999px;
            text-decoration: none;
            font-weight: 500;
            color: ${isDark ? "#93c5fd" : "#1d4ed8"} !important;
            background: ${isDark ? "rgba(37, 99, 235, 0.18)" : "rgba(219, 234, 254, 0.9)"};
            border: 1px solid ${isDark ? "rgba(147, 197, 253, 0.25)" : "rgba(147, 197, 253, 0.55)"};
          }

          .feed-link-tag:active {
            color: ${isDark ? "#bfdbfe" : "#1e40af"} !important;
            background: ${isDark ? "rgba(37, 99, 235, 0.28)" : "rgba(191, 219, 254, 0.95)"};
          }

          a,
          a[data-href],
          .feed-link-url,
          .feed-link-uname {
            color: ${isDark ? "#93c5fd" : "#1d4ed8"} !important;
            text-decoration-color: ${isDark ? "rgba(147, 197, 253, 0.55)" : "rgba(29, 78, 216, 0.45)"};
            text-underline-offset: 2px;
            font-weight: 500;
          }

          a:active,
          a[data-href]:active,
          .feed-link-url:active,
          .feed-link-uname:active {
            color: ${isDark ? "#bfdbfe" : "#1e40af"} !important;
          }
        `}
      </style>
      <ScrollProgressTracker
        onSavePosition={onSavePosition}
        onScrollPositionChange={onScrollPositionChange}
        restorePosition={restoreReadingPosition}
        readingProgressOffset={readingProgressOffset}
        readingProgressAnchor={readingProgressAnchor}
        showProgressBar
        progressBarStyle={{ position: "fixed" }}
      >
        <BookmarkHTMLHighlighter
          htmlContent={htmlContent}
          highlights={highlights}
          readOnly={readOnly}
          onHighlight={onHighlight}
          onUpdateHighlight={onUpdateHighlight}
          onDeleteHighlight={onDeleteHighlight}
          style={contentStyle}
        />
      </ScrollProgressTracker>
    </div>
  );
}
