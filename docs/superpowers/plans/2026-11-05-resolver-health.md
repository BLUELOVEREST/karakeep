# Resolver Health Implementation Plan

**Goal:** Add read-only health monitoring for the five custom resolvers to the administrator service-connections panel; leave background-job statistics and AI configuration unchanged.

**Architecture:** An administrator-only query probes configured resolver health endpoints in parallel, with a three-second timeout and a ten-second process-local cache shared by concurrent requests. Health results expose only platform IDs, stable error codes, timestamps and elapsed time, never endpoint credentials or response bodies. The existing core connection checks remain independent. WeChat receives a stateless GET health endpoint.

**Tech Stack:** TypeScript, tRPC/Zod, native fetch, React/i18next, Nuxt server routes, Vitest and Node assertions. Use the existing upstream-v0341 dependency verification worktree without replacing its generated preview build or unrelated changes.

## Tasks

- [x] Add failing tests in `packages/trpc/lib/resolverHealth.test.ts`: five targets, no request when unconfigured, HTTP/JSON/timeout/network errors, old health endpoints, inactive XHS/MCP, parallel probes, cache/coalescing, URL credential stripping and sanitized results.
- [x] Implement `packages/shared/types/resolverHealth.ts` and `packages/trpc/lib/resolverHealth.ts`. Probe XHS/Coolapk/SMZDM at `/health`, Douyin at `/api/v1/health`, WeChat at `/api/karakeep/v1/health`. Never invoke article/download/config endpoints; reject redirects and non-HTTP URLs.
- [x] Expose `admin.checkResolverConnections` using `adminSystemProcedure`; test non-admin rejection and five unconfigured results in `packages/trpc/routers/admin.test.ts`.
- [x] Add five resolver entries to `apps/web/components/admin/ServiceConnections.tsx`, including safe errors, elapsed time and last-checked time. Provide loading/query-error states, distinguish unsupported checks, preserve the existing four entries and keep the response typed. Add English and Chinese translations and focused rendering tests.
- [x] Add and run the failing Node assertion test `../eric-wechat-article-exporter/test/karakeep_health.ts`, then implement `server/api/karakeep/v1/health.get.ts`. Return only `{ status: 'ok', service: 'wechat-article-exporter' }`, without authentication, storage access or network activity.
- [x] Run Vitest for health checks, administrator routes and affected web components; TypeScript, scoped oxlint/oxfmt and WeChat formatting/tests. Inspect the final diff and document deployment compatibility and AI enablement instructions.

## Verification Commands

Run with Node 24 and installed dependencies in the verification checkout:

```sh
node ../../node_modules/vitest/vitest.mjs run lib/resolverHealth.test.ts routers/admin.test.ts
node ../../node_modules/vitest/vitest.mjs run components/admin/ServiceConnections.test.tsx
node ../../node_modules/typescript/bin/tsc --noEmit
```

From the WeChat checkout:

```sh
node --experimental-strip-types test/karakeep_health.ts
```

No dependency upgrades, commits, build tags or production deployments are part of this request. Existing manual WeChat authentication changes, browser-extension edits and AGENTS.md changes must be preserved.

## Verification Results

- tRPC: 25 files, 512 tests passed, including 15 health tests and administrator authorization checks.
- Web: 11 files, 66 tests passed; generated `.next/**` excluded and the existing auth suite uses a 20-second timeout. Four new component tests cover healthy/unsupported/error/loading states.
- TypeScript checks passed for tRPC and web; scoped oxlint, oxfmt and English/Chinese translation structure checks passed.
- WeChat health assertions and scoped formatting checks passed. A full Nuxt build and real deployed HTTP health check have not been performed.
- Read-only review found no important correctness/security issues. Added explicit regression coverage for a body stalling after response headers, in addition to connection timeouts.
- AI provider selection remains undecided; only setup documentation was added. No credentials, production settings, background-job UI or APK code changed.
