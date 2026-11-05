import { langNameMappings } from "./langs";

export const FOLLOW_INTERFACE_LANGUAGE = "interface";
export const DEFAULT_INFERENCE_LANGUAGE = "Simplified Chinese";

export function resolveInferenceLanguage(
  language?: string | null,
  interfaceLanguage?: string | null,
): string {
  if (language === FOLLOW_INTERFACE_LANGUAGE)
    return langNameMappings[interfaceLanguage ?? "en"] ?? "English";
  return language?.trim() || DEFAULT_INFERENCE_LANGUAGE;
}
