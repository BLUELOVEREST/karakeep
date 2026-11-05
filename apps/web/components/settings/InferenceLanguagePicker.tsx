"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/client";
import {
  DEFAULT_INFERENCE_LANGUAGE,
  FOLLOW_INTERFACE_LANGUAGE,
} from "@karakeep/shared/aiLanguage";
import { langNameMappings } from "@karakeep/shared/langs";

const commonLanguages = [
  "Simplified Chinese",
  "Traditional Chinese",
  "English",
  "Japanese",
  "Korean",
];
const languages = [
  ...commonLanguages,
  ...[...new Set(Object.values(langNameMappings))]
    .filter((name) => !commonLanguages.includes(name))
    .sort((a, b) => a.localeCompare(b, "en")),
];

export default function InferenceLanguagePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState(false);
  const language = value || DEFAULT_INFERENCE_LANGUAGE;
  const isCustom =
    custom ||
    (language !== FOLLOW_INTERFACE_LANGUAGE && !languages.includes(language));
  return (
    <div className="space-y-2">
      <select
        id="inferredTagLang"
        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        value={isCustom ? "custom" : language}
        onChange={(event) => {
          const next = event.target.value;
          setCustom(next === "custom");
          onChange(next === "custom" ? "" : next);
        }}
      >
        <option value={FOLLOW_INTERFACE_LANGUAGE}>
          {t("settings.ai.follow_interface_language")}
        </option>
        {languages.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value="custom">{t("settings.ai.custom_language")}</option>
      </select>
      {isCustom && (
        <Input
          aria-label={t("settings.ai.custom_language")}
          required
          maxLength={128}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
