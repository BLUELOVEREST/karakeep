# Resolver Runtime Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin settings UI for updating Xiaohongshu, Douyin, and WeChat resolver secrets without restarting Karakeep.

**Architecture:** Karakeep stores runtime resolver secrets in SQLite and exposes admin-only TRPC endpoints. Workers merge DB-backed values over environment defaults before selecting resolver providers. Xiaohongshu and Douyin resolver services expose internal config endpoints so Karakeep can push cookie updates immediately.

**Tech Stack:** TypeScript, Drizzle SQLite, TRPC, Next.js settings pages, FastAPI, pytest/vitest.

---

### Task 1: Karakeep Runtime Secret Storage

**Files:**
- Modify: `packages/db/schema.ts`
- Create: `packages/db/drizzle/0068_add_resolver_runtime_configs.sql`
- Create: `packages/shared/types/resolverSettings.ts`
- Create: `packages/trpc/models/resolverSettings.ts`
- Create: `packages/trpc/routers/resolverSettings.ts`
- Modify: `packages/trpc/routers/_app.ts`

- [ ] Add a `resolverRuntimeConfigs` table keyed by resolver id and config key.
- [ ] Add zod schemas for `xhsCookie`, `douyinCookie`, and `wechatArticleAuthKey`.
- [ ] Add admin-only queries/mutations to read masked status, update values, and clear values.
- [ ] Preserve environment fallback by not writing empty strings.

### Task 2: Karakeep Worker Dynamic Resolver Values

**Files:**
- Create: `apps/workers/workers/linkResolver/runtimeConfig.ts`
- Modify: `apps/workers/workers/crawlerWorker.ts`

- [ ] Read DB resolver settings at crawl time.
- [ ] Merge runtime values over `serverConfig.crawler`.
- [ ] Use runtime `wechatArticleAuthKey` for WeChat resolver requests.

### Task 3: Karakeep Settings UI

**Files:**
- Create: `apps/web/app/settings/resolvers/page.tsx`
- Create: `apps/web/app/settings/resolvers/layout.tsx`
- Create: `apps/web/components/settings/ResolverSettings.tsx`
- Modify: `apps/web/app/settings/layout.tsx`

- [ ] Add a sidebar entry named Resolver Settings.
- [ ] Add cards for Xiaohongshu, Douyin, and WeChat.
- [ ] Do not render existing secret values; show configured status and updated timestamp.
- [ ] Save and clear values via TRPC.

### Task 4: Xiaohongshu Runtime Cookie API

**Files:**
- Modify: `eric-xhs-spider/server.py`
- Modify: `eric-xhs-spider/tests/test_server_config.py`
- Modify: `eric-xhs-spider/tests/test_server_api.py`

- [ ] Add in-memory runtime cookie override.
- [ ] Add `GET /api/karakeep/v1/config`.
- [ ] Add `PUT /api/karakeep/v1/config` accepting `xhsCookie`.
- [ ] Ensure `load_cookie()` prefers runtime cookie over env/file.

### Task 5: Douyin Runtime Cookie API

**Files:**
- Modify: `eric-douyin-downloader/server/app.py`
- Modify: `eric-douyin-downloader/tests/test_server.py`

- [ ] Add `GET /api/karakeep/v1/config`.
- [ ] Add `PUT /api/karakeep/v1/config` accepting `douyinCookie`.
- [ ] Parse cookie header and update the running `CookieManager`.

### Task 6: Verification

**Commands:**
- `pnpm --filter @karakeep/db typecheck`
- `pnpm --filter @karakeep/trpc test resolverSettings`
- `pnpm --filter @karakeep/workers test linkResolver`
- `pnpm --filter @karakeep/web typecheck`
- `pytest eric-xhs-spider/tests/test_server_config.py eric-xhs-spider/tests/test_server_api.py`
- `pytest eric-douyin-downloader/tests/test_server.py`

- [ ] Run focused tests for all three repositories.
- [ ] Commit each repository independently.
