// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import BookmarkFavicon from "./BookmarkFavicon";

describe("BookmarkFavicon", () => {
  it("hides the favicon when the image fails to load", () => {
    render(<BookmarkFavicon src="https://example.com/favicon.ico" />);

    fireEvent.error(screen.getByAltText("favicon"));

    expect(screen.queryByAltText("favicon")).toBeNull();
  });
});
