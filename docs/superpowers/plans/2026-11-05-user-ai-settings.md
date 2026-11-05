# User AI Settings Implementation Plan

**Goal:** Implement the approved per-user AI design in `docs/superpowers/specs/2026-11-05-user-ai-settings.md`, without a server-default provider or automatic failover.

**Architecture:** Owner-scoped encrypted profile storage feeds a single runtime resolver. Both model discovery/test calls and inference use a bounded, DNS-pinned outbound transport. Existing inference adapters receive explicit configuration. Web consumes safe profile metadata and offers stable grouped model selection. Background workers resolve the bookmark owner before building a client.

**Tech stack:** SQLite/Drizzle, Zod/tRPC, Node crypto, undici, existing OpenAI/Ollama adapters, React/TanStack Query, Vitest. Preserve unrelated resolver-health work and browser-extension/AGENTS changes; reuse the installed-dependency verification checkout for tests.

## Tasks

- [x] Contracts and persistence: shared user AI schemas, natural model grouping, userAIConfig table/migration, AES-256-GCM storage with independent `AI_CONFIG_ENCRYPTION_KEY`, owner isolation, key replacement/clear rules and optimistic configuration revisions. Failing-first tests followed by passing owner/CAS/encryption tests.
- [x] Outbound transport: HTTP(S)-only base URLs without embedded credentials/query/fragment; exact administrator-approved private origins via `AI_ALLOWED_PRIVATE_ORIGINS`; IP classification, DNS pinning, redirect rejection, deadline and response-size bounds. Transport tests cover rebind/mapped-IP/timeout/oversize and isolation.
- [x] Provider service/API: authenticated `userAI.get/save/clearKey/models/test` routes, rate limits, draft-key handling, model list sorting/limits, actual text/vision test calls using synthetic test data. Stable sanitized errors, no raw key/ciphertext in responses, no default provider fallback.
- [x] Runtime integration: explicit adapter transport/configuration, owner-first worker selection, no global tag/summary feature gates, manual summary ownership, disabled/skipped outcomes and errors. Optional OCR uses personal vision or local fallback; embedding indexes unchanged.
- [x] Web: existing AI page always visible, personal enable/connection/model/output controls, searchable grouped dropdowns with manual ID fallback, refresh-preserved selection, stale-response protection, masked credentials, actual text/vision tests, privacy/cost notice and existing personal preferences. Focused rendering/state tests pass.
- [x] Verification: affected suites and typechecks, schema-generation consistency, dependency-lock alignment, formatting/lint, independent security/spec review, isolated local preview and browser checks; deployment requirements documented.

## Verification Record

- tRPC: 518 tests passed. Web: 81 tests passed using `--exclude '**/.next/**' --testTimeout 30000`; generated standalone fixtures are not Vitest suites, and the existing password-hashing test exceeds its default 5-second timeout under parallel load.
- Shared: 182 tests passed after strict Ollama response validation. Personal AI server suite: 63 tests passed; focused worker suite: 22 passed. Typechecks passed for shared, shared-server, DB, tRPC, workers and Web.
- Drizzle generation reports no further schema changes after migration `0098_user_ai_config`. Shared package manifest and lock importer match. Scoped lint/format and `git diff --check` pass.
- Independent review found and verified the fix for Ollama SDK streaming-parser logging. Personal calls now use complete validated responses; malformed responses cannot log raw content or report partial success. Tag parsing errors and success logs no longer expose upstream response snippets.
- Chromium verified actual registration/login, personal settings save/reload, empty password value with configured-key mask, desktop/mobile dark layout, no horizontal overflow or page errors. Preview uses `/tmp/karakeep-user-ai-preview`, port `13002`, user unit `karakeep-user-ai-preview-web`; no production/test deployment data was changed.
- No real AI endpoint was called. Real text/vision model compatibility remains an explicit user test after configuration. No commit, push, tag, image build or production deployment performed.

## Working Contracts

Provider values are `openai` and `ollama`; output formats `structured`, `json`, `plain`. A profile contains `enabled`, `provider`, `baseUrl`, `textModel`, nullable `imageModel`, `outputSchema`, `useMaxCompletionTokens`, `revision`. Safe metadata also contains `keyConfigured`, `encryptionAvailable`, nullable `updatedAt`; never a key or ciphertext. Draft requests add optional `apiKey` and optional `revision`; omitted/blank key retains a stored key only for the exact same provider/base URL. Save requires an expected revision, including `0` for a new profile. Clearing a key disables the profile. Text/vision tests return only safe status/error codes, configuration fingerprint and latency; model discovery returns sorted `{id, group}` entries without inferring vision capability.

Verification uses Node 24 directly to avoid pnpm's automatic dependency reinstallation. No commit, push, build tag, real AI provider call or production change is authorized by this implementation request. Real provider tests require later user-supplied configuration and explicit opt-in to the test buttons.
