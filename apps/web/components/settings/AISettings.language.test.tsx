// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AIPreferences } from "./AISettings";

const state = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/lib/i18n/client", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/userSettings", () => ({
  useUserSettings: () => ({
    inferredTagLang: null,
    autoTaggingEnabled: true,
    autoSummarizationEnabled: false,
  }),
}));
vi.mock("@/lib/userLocalSettings/bookmarksLayout", () => ({
  useInterfaceLang: () => "zh",
}));
vi.mock("@karakeep/shared-react/hooks/users", () => ({
  useUpdateUserSettings: () => ({ mutate: state.save, isPending: false }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("submits follow mode and current interface language from the actual preferences form", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  render(<AIPreferences />);
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "interface" },
  });
  fireEvent.click(screen.getByRole("button", { name: "actions.save" }));
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledWith({
      inferredTagLang: "interface",
      interfaceLang: "zh",
      autoTaggingEnabled: true,
      autoSummarizationEnabled: false,
    }),
  );
});
