import type { UserAIProfile } from "@karakeep/shared/types/userAI";

export function canUseUserAI(profile: UserAIProfile | undefined) {
  return (
    !!profile?.enabled &&
    profile.encryptionAvailable &&
    !!profile.baseUrl &&
    !!profile.textModel &&
    (profile.provider === "ollama" || profile.keyConfigured)
  );
}
