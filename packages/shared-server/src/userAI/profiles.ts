import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "@karakeep/db";
import { userAIConfigs } from "@karakeep/db/schema";
import serverConfig from "@karakeep/shared/config";
import type {
  UserAIDraft,
  UserAIProfile,
  UserAISettings,
} from "@karakeep/shared/types/userAI";
import { normalizeUserAIBaseUrl } from "@karakeep/shared/userAINetwork";
import { decryptAIKey, encryptAIKey, readAIEncryptionKey } from "./crypto";
import { UserAIError, sanitizeUserAIError } from "./errors";

export interface ResolvedUserAI {
  settings: UserAISettings;
  apiKey: string | null;
  fingerprint: string;
}

const defaults: UserAISettings = {
  enabled: false,
  provider: "openai",
  baseUrl: "",
  textModel: "",
  imageModel: null,
  outputSchema: "structured",
  useMaxCompletionTokens: false,
};
const context = (userId: string, settings: UserAISettings) =>
  JSON.stringify([userId, settings.provider, settings.baseUrl]);

export class UserAIProfiles {
  constructor(
    private readonly db: DB,
    private readonly masterKey = serverConfig.userAI.encryptionKey,
  ) {}

  private row(userId: string) {
    return this.db
      .select()
      .from(userAIConfigs)
      .where(eq(userAIConfigs.userId, userId))
      .get();
  }

  get(userId: string): UserAIProfile {
    const row = this.row(userId);
    let encryptionAvailable = true;
    try {
      readAIEncryptionKey(this.masterKey);
    } catch {
      encryptionAvailable = false;
    }
    return {
      enabled: row?.enabled ?? defaults.enabled,
      provider: row?.provider ?? defaults.provider,
      baseUrl: row?.baseUrl ?? "",
      textModel: row?.textModel ?? "",
      imageModel: row?.imageModel ?? null,
      outputSchema: row?.outputSchema ?? defaults.outputSchema,
      useMaxCompletionTokens: row?.useMaxCompletionTokens ?? false,
      revision: row?.revision ?? 0,
      keyConfigured: !!row?.encryptedApiKey,
      encryptionAvailable,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  private normalize(draft: UserAIDraft): UserAISettings {
    try {
      return {
        enabled: draft.enabled,
        provider: draft.provider,
        baseUrl: normalizeUserAIBaseUrl(draft.baseUrl),
        textModel: draft.textModel,
        imageModel: draft.imageModel,
        outputSchema: draft.outputSchema,
        useMaxCompletionTokens: draft.useMaxCompletionTokens,
      };
    } catch (error) {
      throw sanitizeUserAIError(error);
    }
  }

  resolveDraft(userId: string, draft: UserAIDraft): ResolvedUserAI {
    const row = this.row(userId);
    if (draft.revision !== undefined && draft.revision !== (row?.revision ?? 0))
      throw new UserAIError("CONFLICT");
    const settings = this.normalize(draft);
    let apiKey = draft.apiKey?.trim() || null;
    if (!apiKey && row?.encryptedApiKey) {
      if (
        row.provider !== settings.provider ||
        row.baseUrl !== settings.baseUrl
      )
        throw new UserAIError("KEY_REENTRY_REQUIRED");
      apiKey = decryptAIKey(
        row.encryptedApiKey,
        context(userId, settings),
        this.masterKey,
      );
    }
    if (settings.provider === "openai" && !apiKey)
      throw new UserAIError("KEY_REQUIRED");
    const fingerprint = createHmac(
      "sha256",
      readAIEncryptionKey(this.masterKey),
    )
      .update(JSON.stringify([userId, settings, apiKey]))
      .digest("hex");
    return { settings, apiKey, fingerprint };
  }

  save(
    userId: string,
    draft: UserAIDraft & { revision: number },
  ): UserAIProfile {
    readAIEncryptionKey(this.masterKey);
    this.db.transaction(() => {
      const row = this.row(userId);
      if (draft.revision !== (row?.revision ?? 0))
        throw new UserAIError("CONFLICT");
      const settings = this.normalize(draft);
      if (settings.enabled && !settings.textModel)
        throw new UserAIError("UNCONFIGURED");
      let encryptedApiKey = row?.encryptedApiKey ?? null;
      if (draft.apiKey?.trim())
        encryptedApiKey = encryptAIKey(
          draft.apiKey.trim(),
          context(userId, settings),
          this.masterKey,
        );
      else if (
        encryptedApiKey &&
        (row!.provider !== settings.provider ||
          row!.baseUrl !== settings.baseUrl)
      )
        throw new UserAIError("KEY_REENTRY_REQUIRED");
      if (
        settings.enabled &&
        settings.provider === "openai" &&
        !encryptedApiKey
      )
        throw new UserAIError("KEY_REQUIRED");
      const values = {
        userId,
        ...settings,
        encryptedApiKey,
        revision: draft.revision + 1,
        updatedAt: new Date(),
      };
      this.db
        .insert(userAIConfigs)
        .values(values)
        .onConflictDoUpdate({ target: userAIConfigs.userId, set: values })
        .run();
    });
    return this.get(userId);
  }

  clearKey(userId: string, revision: number): UserAIProfile {
    this.db.transaction(() => {
      const row = this.row(userId);
      if (revision !== (row?.revision ?? 0)) throw new UserAIError("CONFLICT");
      if (row)
        this.db
          .update(userAIConfigs)
          .set({
            encryptedApiKey: null,
            enabled: false,
            revision: revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(userAIConfigs.userId, userId))
          .run();
    });
    return this.get(userId);
  }

  resolveEnabled(
    userId: string,
    modality: "text" | "vision" = "text",
  ): ResolvedUserAI | null {
    const row = this.row(userId);
    if (
      !row?.enabled ||
      !row.textModel ||
      (modality === "vision" && !row.imageModel)
    )
      return null;
    if (row.provider === "openai" && !row.encryptedApiKey) return null;
    return this.resolveDraft(userId, row);
  }
}
