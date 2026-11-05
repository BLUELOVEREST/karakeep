// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import InferenceLanguagePicker from "./InferenceLanguagePicker";

vi.mock("@/lib/i18n/client", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);
it("offers an explicit follow-interface option and defaults to Chinese", () => {
  const change = vi.fn();
  render(<InferenceLanguagePicker value={null} onChange={change} />);
  const select = screen.getByRole("combobox") as HTMLSelectElement;
  expect(select.value).toBe("Simplified Chinese");
  fireEvent.change(select, { target: { value: "interface" } });
  expect(change).toHaveBeenCalledWith("interface");
});
it("keeps legacy custom language values editable", () => {
  render(
    <InferenceLanguagePicker value="Custom language" onChange={vi.fn()} />,
  );
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
    "Custom language",
  );
});
it("only shows a text field when custom language is selected", () => {
  render(<InferenceLanguagePicker value="English" onChange={vi.fn()} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "custom" },
  });
  expect(screen.getByRole("textbox")).toBeTruthy();
});
