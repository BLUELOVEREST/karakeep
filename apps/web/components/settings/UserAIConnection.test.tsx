// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import UserAIConnection from "./UserAIConnection";
import { canUseUserAI } from "../../lib/userAI";
import type { UserAIProfile } from "@karakeep/shared/types/userAI";
import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import SummarizeBookmarkArea from "../dashboard/bookmarks/SummarizeBookmarkArea";

const state = vi.hoisted(() => ({
  profile: {
    enabled: false,
    provider: "openai",
    baseUrl: "https://example.com/v1",
    textModel: "old-model",
    imageModel: null,
    outputSchema: "structured",
    useMaxCompletionTokens: false,
    revision: 3,
    keyConfigured: true,
    encryptionAvailable: true,
    updatedAt: null,
  },
  save: vi.fn(),
  models: vi.fn(),
  test: vi.fn(),
  clearKey: vi.fn(),
}));
vi.mock("@karakeep/shared-react/hooks/bookmarks", () => ({
  useSummarizeBookmark: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateBookmark: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ui/markdown/markdown-readonly", () => ({
  MarkdownReadonly: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/lib/i18n/client", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@karakeep/shared-react/trpc", () => ({
  useTRPC: () => ({
    userAI: {
      get: { queryOptions: () => ({ queryKey: ["userAI"] }) },
      ...Object.fromEntries(
        ["save", "models", "test", "clearKey"].map((kind) => [
          kind,
          { mutationOptions: () => ({ kind }) },
        ]),
      ),
    },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: state.profile }),
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
  useMutation: ({
    kind,
  }: {
    kind: "save" | "models" | "test" | "clearKey";
  }) => ({ mutateAsync: state[kind], isPending: false }),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.clearAllMocks();
  state.profile.encryptionAvailable = true;
  state.profile.enabled = false;
  state.save.mockImplementation(async (value) => ({
    ...state.profile,
    ...value,
    revision: value.revision + 1,
  }));
  state.models.mockResolvedValue({
    models: [],
    errorCode: null,
    fingerprint: "a",
  });
  state.test.mockResolvedValue({
    kind: "text",
    status: "passed",
    errorCode: null,
    fingerprint: "a",
    latencyMs: 1,
  });
});

it("keeps the master off, masks the stored key and saves with updated CAS revision", async () => {
  render(<UserAIConnection />);
  expect(
    screen
      .getByLabelText("settings.ai.user_ai.enabled")
      .getAttribute("aria-checked"),
  ).toBe("false");
  expect(
    (screen.getByLabelText("settings.ai.user_ai.api_key") as HTMLInputElement)
      .type,
  ).toBe("password");
  fireEvent.click(screen.getByText("actions.save"));
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 3, enabled: false }),
    ),
  );
  fireEvent.click(screen.getByText("actions.save"));
  await waitFor(() =>
    expect(state.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: 4 }),
    ),
  );
});

it("never fetches models or tests inference without an explicit button click", () => {
  render(<UserAIConnection />);
  fireEvent.change(screen.getByLabelText("settings.ai.user_ai.api_key"), {
    target: { value: "replacement-key" },
  });
  fireEvent.click(screen.getByLabelText("settings.ai.user_ai.enabled"));
  expect(state.models).not.toHaveBeenCalled();
  expect(state.test).not.toHaveBeenCalled();
});

it("never submits a replacement key to a newly edited destination", () => {
  render(<UserAIConnection />);
  const input = screen.getByLabelText(
    "settings.ai.user_ai.api_key",
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "old-destination-secret" } });
  fireEvent.change(screen.getByLabelText("settings.ai.user_ai.base_url"), {
    target: { value: "https://other.example/v1" },
  });
  expect(input.value).toBe("");
  expect(
    (screen.getByText("settings.ai.user_ai.fetch_models") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("blocks saving and explains missing server encryption", () => {
  state.profile.encryptionAvailable = false;
  render(<UserAIConnection />);
  expect((screen.getByText("actions.save") as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByRole("alert").textContent).toContain("encryption_missing");
});

it("requires fresh credentials after changing the destination", () => {
  render(<UserAIConnection />);
  fireEvent.change(screen.getByLabelText("settings.ai.user_ai.base_url"), {
    target: { value: "https://new.example/v1" },
  });
  expect(screen.getByRole("alert").textContent).toContain(
    "KEY_REENTRY_REQUIRED",
  );
  expect((screen.getByText("actions.save") as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it("ignores test results arriving after a draft edit", async () => {
  let resolve!: (value: unknown) => void;
  state.test.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(<UserAIConnection />);
  fireEvent.click(screen.getByText("settings.ai.user_ai.test_text"));
  fireEvent.change(screen.getByLabelText("settings.ai.user_ai.base_url"), {
    target: { value: "https://new.example/v1" },
  });
  resolve({
    kind: "text",
    status: "passed",
    errorCode: null,
    fingerprint: "a",
    latencyMs: 1,
  });
  await waitFor(() => expect(state.test).toHaveBeenCalled());
  expect(screen.queryByText(/status.passed/)).toBeNull();
});

it("preserves selected IDs on refresh and list failure", async () => {
  render(<UserAIConnection />);
  fireEvent.click(screen.getByText("settings.ai.user_ai.fetch_models"));
  await screen.findAllByText("settings.ai.user_ai.no_models");
  expect(screen.getByText("old-model")).toBeTruthy();
  expect(screen.getByText("settings.ai.user_ai.missing_model")).toBeTruthy();
  state.models.mockResolvedValueOnce({
    models: [],
    errorCode: "AUTH_FAILED",
    fingerprint: null,
  });
  fireEvent.click(screen.getByText("settings.ai.user_ai.fetch_models"));
  await screen.findByRole("alert");
  expect(screen.getByText("old-model")).toBeTruthy();
});

it("ignores a model list response after editing a model", async () => {
  let resolve!: (value: unknown) => void;
  state.models.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(<UserAIConnection />);
  fireEvent.click(screen.getByText("settings.ai.user_ai.fetch_models"));
  fireEvent.click(screen.getAllByLabelText("settings.ai.user_ai.manual_id")[0]);
  fireEvent.change(screen.getByLabelText("settings.ai.user_ai.text_model"), {
    target: { value: "manual-model" },
  });
  resolve({
    models: [{ id: "stale", group: null }],
    errorCode: null,
    fingerprint: "a",
  });
  await waitFor(() => expect(state.models).toHaveBeenCalled());
  expect(screen.queryByText("settings.ai.user_ai.missing_model")).toBeNull();
  expect(
    (
      screen.getByLabelText(
        "settings.ai.user_ai.text_model",
      ) as HTMLInputElement
    ).value,
  ).toBe("manual-model");
});

it("sorts grouped models naturally and retains ordering when searching", async () => {
  state.models.mockResolvedValue({
    models: [
      "gpt-10",
      "z/model-2",
      "a/model-10",
      "gpt-2",
      "a/model-2",
      "a/model-2",
    ].map((id) => ({ id, group: null })),
    errorCode: null,
    fingerprint: "a",
  });
  render(<UserAIConnection />);
  fireEvent.click(screen.getByText("settings.ai.user_ai.fetch_models"));
  await waitFor(() => expect(state.models).toHaveBeenCalled());
  const input = screen.getByLabelText("settings.ai.user_ai.text_model");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  await waitFor(() =>
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((el) => el.textContent),
    ).toEqual(["a/model-2", "a/model-10", "z/model-2", "gpt-2", "gpt-10"]),
  );
  fireEvent.change(input, { target: { value: "model" } });
  expect(
    within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((el) => el.textContent),
  ).toEqual(["a/model-2", "a/model-10", "z/model-2"]);
});

it("allows testing while disabled and invalidates a passed result on request parameter edits", async () => {
  render(<UserAIConnection />);
  fireEvent.click(screen.getByText("settings.ai.user_ai.test_text"));
  await screen.findByText("settings.ai.user_ai.status.passed");
  expect(state.test).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: false, kind: "text" }),
  );
  fireEvent.change(screen.getByLabelText("settings.ai.user_ai.output_schema"), {
    target: { value: "plain" },
  });
  expect(screen.queryByText("settings.ai.user_ai.status.passed")).toBeNull();
});

it("clears the key separately with CAS and accepts the disabled profile", async () => {
  state.clearKey.mockResolvedValue({
    ...state.profile,
    keyConfigured: false,
    enabled: false,
    revision: 4,
  });
  render(<UserAIConnection />);
  fireEvent.click(screen.getByText("settings.ai.user_ai.clear_key"));
  await waitFor(() =>
    expect(state.clearKey).toHaveBeenCalledWith({ revision: 3 }),
  );
  await waitFor(() =>
    expect(screen.queryByText("settings.ai.user_ai.clear_key")).toBeNull(),
  );
  expect(state.save).not.toHaveBeenCalled();
});

it("does not infer vision capability from a model ID or list", async () => {
  state.test.mockResolvedValue({
    kind: "vision",
    status: "unverified",
    errorCode: "TIMEOUT",
    fingerprint: "a",
    latencyMs: 100,
  });
  render(<UserAIConnection />);
  fireEvent.click(screen.getAllByLabelText("settings.ai.user_ai.manual_id")[1]);
  fireEvent.change(screen.getByLabelText("settings.ai.user_ai.vision_model"), {
    target: { value: "vision-latest" },
  });
  expect(screen.queryByText("settings.ai.user_ai.status.passed")).toBeNull();
  fireEvent.click(screen.getByText("settings.ai.user_ai.test_vision"));
  await screen.findByText(/errors.TIMEOUT/);
  expect(
    screen.queryByText("settings.ai.user_ai.status.unsupported"),
  ).toBeNull();
});

it("uses only personal profile availability, including keyless Ollama", () => {
  const profile = {
    ...state.profile,
    enabled: true,
    provider: "openai",
    outputSchema: "structured",
  } as UserAIProfile;
  expect(canUseUserAI(undefined)).toBe(false);
  expect(canUseUserAI(profile)).toBe(true);
  for (const patch of [
    { enabled: false },
    { textModel: "" },
    { keyConfigured: false },
    { encryptionAvailable: false },
  ]) {
    expect(canUseUserAI({ ...profile, ...patch })).toBe(false);
  }
  expect(
    canUseUserAI({ ...profile, provider: "ollama", keyConfigured: false }),
  ).toBe(true);
});

it("offers manual summaries with personal AI even without any global provider", () => {
  state.profile.enabled = true;
  const bookmark = {
    id: "bookmark",
    content: { type: "link" },
    summary: null,
  } as ZBookmark;
  const { rerender } = render(<SummarizeBookmarkArea bookmark={bookmark} />);
  expect(screen.getByText("actions.summarize_with_ai")).toBeTruthy();
  state.profile.enabled = false;
  rerender(<SummarizeBookmarkArea bookmark={bookmark} />);
  expect(screen.queryByText("actions.summarize_with_ai")).toBeNull();
});

it("preserves read-only summaries without exposing AI or editing actions", () => {
  state.profile.enabled = true;
  const bookmark = {
    id: "bookmark",
    content: { type: "link" },
    summary: null,
  } as ZBookmark;
  const { rerender } = render(
    <SummarizeBookmarkArea bookmark={bookmark} readOnly />,
  );
  expect(screen.queryByText("actions.summarize_with_ai")).toBeNull();
  rerender(
    <SummarizeBookmarkArea
      bookmark={{ ...bookmark, summary: "existing-summary" }}
      readOnly
    />,
  );
  expect(screen.getByText("existing-summary")).toBeTruthy();
  fireEvent.click(screen.getByText("existing-summary"));
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByLabelText("Collapse")).toBeTruthy();
});
