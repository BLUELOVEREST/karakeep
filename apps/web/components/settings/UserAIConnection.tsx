"use client";

import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import Select from "react-select";
import { Download, FlaskConical, Save, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/ui/action-button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/lib/i18n/client";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { sortUserAIModels, zUserAISave } from "@karakeep/shared/types/userAI";
import type {
  UserAIDraft,
  UserAIProfile,
  UserAIErrorCode,
  UserAIModel,
} from "@karakeep/shared/types/userAI";
import { SettingsSection } from "./SettingsPage";

interface TestResult {
  status: "passed" | "unsupported" | "unverified";
  errorCode: UserAIErrorCode | null;
}

function ModelPicker({
  kind,
  value,
  models,
  loaded,
  onChange,
}: {
  kind: "text" | "vision";
  value: string;
  models: UserAIModel[];
  loaded: boolean;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [manual, setManual] = useState(false);
  const id = `user-ai-${kind}-model`;
  const groups = [...new Set(models.map((model) => model.group))];
  return (
    <div className="min-w-0 space-y-2">
      <label className="text-sm font-medium" htmlFor={id}>
        {t(`settings.ai.user_ai.${kind}_model`)}
      </label>
      <div className="flex items-center gap-2 text-sm">
        <Switch
          id={`${id}-manual`}
          checked={manual}
          onCheckedChange={setManual}
        />
        <label htmlFor={`${id}-manual`}>
          {t("settings.ai.user_ai.manual_id")}
        </label>
      </div>
      {manual ? (
        <Input
          id={id}
          value={value}
          maxLength={256}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Select
          inputId={id}
          isSearchable
          isClearable={kind === "vision"}
          className="text-sm"
          classNamePrefix="user-ai-model"
          unstyled
          classNames={{
            control: () => "min-h-10 rounded-md border bg-background px-3",
            menu: () =>
              "z-50 rounded-md border bg-popover text-popover-foreground shadow-md",
            menuList: () => "max-h-64 overflow-auto",
            option: ({ isFocused }) =>
              `break-all px-3 py-2 ${isFocused ? "bg-accent" : ""}`,
            groupHeading: () => "px-3 py-1 text-xs text-muted-foreground",
            input: () => "text-foreground",
            valueContainer: () => "min-w-0",
            singleValue: () => "truncate",
            placeholder: () => "text-muted-foreground",
          }}
          value={value ? { value, label: value } : null}
          onChange={(option) => onChange(option?.value ?? "")}
          placeholder={t("settings.ai.user_ai.select_model")}
          noOptionsMessage={() => t("settings.ai.user_ai.no_models")}
          options={groups.map((group) => ({
            label: group ?? t("settings.ai.user_ai.ungrouped"),
            options: models
              .filter((model) => model.group === group)
              .map((model) => ({ value: model.id, label: model.id })),
          }))}
        />
      )}
      {loaded && value && !models.some((model) => model.id === value) && (
        <p className="text-sm text-muted-foreground">
          {t("settings.ai.user_ai.missing_model")}
        </p>
      )}
    </div>
  );
}

function ConnectionForm({ initial }: { initial: UserAIProfile }) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [profile, setProfile] = useState(initial);
  const toDraft = (value: UserAIProfile): UserAIDraft => ({
    enabled: value.enabled,
    provider: value.provider,
    baseUrl: value.baseUrl,
    textModel: value.textModel,
    imageModel: value.imageModel,
    outputSchema: value.outputSchema,
    useMaxCompletionTokens: value.useMaxCompletionTokens,
    revision: value.revision,
  });
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [models, setModels] = useState<UserAIModel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [results, setResults] = useState<
    Partial<Record<"text" | "vision", TestResult>>
  >({});
  const [error, setError] = useState<UserAIErrorCode | "REQUEST_FAILED" | null>(
    null,
  );
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const modelRequest = useRef(0);
  const testRequests = useRef({ text: 0, vision: 0 });
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const save = useMutation(api.userAI.save.mutationOptions());
  const clear = useMutation(api.userAI.clearKey.mutationOptions());
  const list = useMutation(api.userAI.models.mutationOptions());
  const test = useMutation(api.userAI.test.mutationOptions());
  const busy = save.isPending || clear.isPending;
  const destinationChanged =
    draft.provider !== profile.provider ||
    draft.baseUrl.trim() !== profile.baseUrl;
  const reentry =
    profile.keyConfigured && destinationChanged && !draft.apiKey?.trim();
  const keyMissing =
    draft.provider === "openai" &&
    !draft.apiKey?.trim() &&
    !profile.keyConfigured;
  const valid = zUserAISave.safeParse(draft).success;
  const requestReady =
    !!draft.baseUrl.trim() &&
    !reentry &&
    !keyMissing &&
    profile.encryptionAvailable;

  function edit(patch: Partial<UserAIDraft>) {
    if (busy) return;
    generation.current++;
    if (patch.provider !== undefined || patch.baseUrl !== undefined) {
      patch.apiKey = undefined;
      setModels([]);
      setLoaded(false);
    }
    setDraft((current) => ({ ...current, ...patch }));
    setResults({});
    setError(null);
    setSaved(false);
  }
  function accept(value: UserAIProfile) {
    generation.current++;
    setProfile(value);
    setDraft(toDraft(value));
    setResults({});
    setSaved(true);
    setError(null);
    queryClient.setQueryData(api.userAI.get.queryOptions().queryKey, value);
    void queryClient.invalidateQueries({
      queryKey: api.userAI.get.queryOptions().queryKey,
    });
  }
  async function persist(clearKey = false) {
    setError(null);
    setSaved(false);
    try {
      const value = clearKey
        ? await clear.mutateAsync({ revision: profile.revision })
        : await save.mutateAsync({ ...draft, revision: profile.revision });
      accept(value);
    } catch (cause) {
      setError(
        cause instanceof TRPCClientError && cause.data?.code === "CONFLICT"
          ? "CONFLICT"
          : "REQUEST_FAILED",
      );
    }
  }
  async function fetchModels() {
    const version = generation.current;
    const request = ++modelRequest.current;
    setError(null);
    try {
      const value = await list.mutateAsync(draft);
      if (version !== generation.current || request !== modelRequest.current)
        return;
      if (value.errorCode) {
        setError(value.errorCode);
        return;
      }
      setModels(sortUserAIModels(value.models.map((model) => model.id)));
      setLoaded(true);
    } catch {
      if (version === generation.current && request === modelRequest.current)
        setError("REQUEST_FAILED");
    }
  }
  async function runTest(kind: "text" | "vision") {
    const version = generation.current;
    const request = ++testRequests.current[kind];
    setResults((current) => ({ ...current, [kind]: undefined }));
    setError(null);
    try {
      const value = await test.mutateAsync({ ...draft, kind });
      if (
        version === generation.current &&
        request === testRequests.current[kind]
      )
        setResults((current) => ({ ...current, [kind]: value }));
    } catch {
      if (
        version === generation.current &&
        request === testRequests.current[kind]
      )
        setError("REQUEST_FAILED");
    }
  }
  return (
    <SettingsSection title={t("settings.ai.user_ai.title")}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && valid && requestReady) void persist();
        }}
      >
        {!profile.encryptionAvailable && (
          <p role="alert" className="text-sm text-destructive">
            {t("settings.ai.user_ai.encryption_missing")}
          </p>
        )}
        {(reentry || error) && (
          <p role="alert" className="text-sm text-destructive">
            {t(
              `settings.ai.user_ai.errors.${reentry ? "KEY_REENTRY_REQUIRED" : (error ?? "UNKNOWN")}`,
            )}
          </p>
        )}
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="user-ai-enabled"
              checked={draft.enabled}
              onCheckedChange={(enabled) => edit({ enabled })}
            />
            <label htmlFor="user-ai-enabled">
              {t("settings.ai.user_ai.enabled")}
            </label>
          </div>
          <div className="space-y-2">
            <label htmlFor="user-ai-provider" className="text-sm font-medium">
              {t("settings.ai.user_ai.provider")}
            </label>
            <select
              id="user-ai-provider"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={draft.provider}
              onChange={(event) =>
                edit({
                  provider: event.target.value as UserAIDraft["provider"],
                })
              }
            >
              <option value="openai">{t("settings.ai.user_ai.openai")}</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="user-ai-url" className="text-sm font-medium">
              {t("settings.ai.user_ai.base_url")}
            </label>
            <Input
              id="user-ai-url"
              type="url"
              maxLength={2048}
              value={draft.baseUrl}
              onChange={(event) => edit({ baseUrl: event.target.value })}
            />
            <p className="text-sm text-muted-foreground">
              {t("settings.ai.user_ai.url_notice")}
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="user-ai-key" className="text-sm font-medium">
              {t("settings.ai.user_ai.api_key")}
            </label>
            <Input
              id="user-ai-key"
              type="password"
              autoComplete="new-password"
              maxLength={4096}
              value={draft.apiKey ?? ""}
              placeholder={profile.keyConfigured ? "********" : ""}
              onChange={(event) =>
                edit({ apiKey: event.target.value || undefined })
              }
            />
            <p className="text-sm text-muted-foreground">
              {t(
                `settings.ai.user_ai.${profile.keyConfigured ? "key_configured" : "key_optional"}`,
              )}
            </p>
            {profile.keyConfigured && (
              <ActionButton
                type="button"
                variant="destructive"
                loading={clear.isPending}
                onClick={() => void persist(true)}
              >
                <Trash2 className="size-4" />
                {t("settings.ai.user_ai.clear_key")}
              </ActionButton>
            )}
          </div>
          <ActionButton
            type="button"
            variant="secondary"
            loading={list.isPending}
            disabled={!requestReady}
            onClick={() => void fetchModels()}
          >
            <Download className="size-4" />
            {t("settings.ai.user_ai.fetch_models")}
          </ActionButton>
          {loaded && models.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("settings.ai.user_ai.no_models")}
            </p>
          )}
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <ModelPicker
              kind="text"
              value={draft.textModel}
              models={models}
              loaded={loaded}
              onChange={(textModel) => edit({ textModel })}
            />
            <ModelPicker
              kind="vision"
              value={draft.imageModel ?? ""}
              models={models}
              loaded={loaded}
              onChange={(imageModel) =>
                edit({ imageModel: imageModel || null })
              }
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="user-ai-output" className="text-sm font-medium">
              {t("settings.ai.user_ai.output_schema")}
            </label>
            <select
              id="user-ai-output"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={draft.outputSchema}
              onChange={(event) =>
                edit({
                  outputSchema: event.target
                    .value as UserAIDraft["outputSchema"],
                })
              }
            >
              {(["structured", "json", "plain"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`settings.ai.user_ai.output.${value}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="user-ai-max-tokens"
              checked={draft.useMaxCompletionTokens}
              onCheckedChange={(useMaxCompletionTokens) =>
                edit({ useMaxCompletionTokens })
              }
            />
            <label htmlFor="user-ai-max-tokens" className="text-sm">
              {t("settings.ai.user_ai.max_completion_tokens")}
            </label>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("settings.ai.user_ai.privacy_notice")}
          </p>
          <div className="flex flex-wrap gap-3">
            {(["text", "vision"] as const).map((kind) => (
              <div key={kind} className="space-y-2">
                <ActionButton
                  type="button"
                  variant="secondary"
                  loading={test.isPending}
                  disabled={
                    !requestReady ||
                    !(kind === "text"
                      ? draft.textModel.trim()
                      : draft.imageModel?.trim())
                  }
                  onClick={() => void runTest(kind)}
                >
                  <FlaskConical className="size-4" />
                  {t(`settings.ai.user_ai.test_${kind}`)}
                </ActionButton>
                <p role="status" className="text-sm">
                  {t(
                    `settings.ai.user_ai.status.${results[kind]?.status ?? "unverified"}`,
                  )}
                  {results[kind]?.errorCode &&
                    `: ${t(`settings.ai.user_ai.errors.${results[kind]?.errorCode}`)}`}
                </p>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {t("settings.ai.user_ai.vision_notice")}
          </p>
          <ActionButton
            type="submit"
            loading={save.isPending}
            disabled={!valid || !requestReady || busy}
          >
            <Save className="size-4" />
            {t("actions.save")}
          </ActionButton>
          {saved && (
            <p role="status" className="text-sm">
              {t("settings.ai.user_ai.saved")}
            </p>
          )}
        </fieldset>
      </form>
    </SettingsSection>
  );
}

export default function UserAIConnection() {
  const api = useTRPC();
  const { t } = useTranslation();
  const query = useQuery(api.userAI.get.queryOptions());
  if (!query.data)
    return (
      <p role={query.isError ? "alert" : "status"}>
        {t(`settings.ai.user_ai.${query.isError ? "load_failed" : "loading"}`)}
      </p>
    );
  return <ConnectionForm initial={query.data} />;
}
