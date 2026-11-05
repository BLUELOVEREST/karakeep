import type { DB } from "@karakeep/db";
import serverConfig from "@karakeep/shared/config";
import { createUserAIInferenceClient } from "./client";
import { UserAIProfiles } from "./profiles";

export { UserAIProfiles } from "./profiles";
export { UserAIError, sanitizeUserAIError } from "./errors";
export { discoverUserAIModels, testUserAIConnection } from "./probes";

export async function getUserAIClient(
  db: DB,
  userId: string,
  modality: "text" | "vision" = "text",
) {
  const resolved = new UserAIProfiles(db).resolveEnabled(userId, modality);
  if (!resolved) return null;
  return createUserAIInferenceClient(
    resolved.settings,
    resolved.apiKey,
    serverConfig.userAI.allowedPrivateOrigins,
  );
}
