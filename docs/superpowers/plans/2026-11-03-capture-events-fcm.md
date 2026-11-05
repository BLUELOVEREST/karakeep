# Capture Events and FCM Implementation Plan

Goal: Persist capture incidents and deliver actionable, privacy-safe FCM notifications independently of crawling.

Architecture: A per-bookmark capture state tracks running/retrying/final/partial/recovered outcomes. Immutable owner-scoped events form the durable source of truth. A persistent delivery outbox uses leases, bounded exponential retries and authentication-error grouping; a channel interface initially implements only FCM using Firebase Admin SDK. Android uses native FCM tokens through expo-notifications, with explicit opt-in and account/server-scoped navigation. No Telegram or Bark integration is included.

- [x] Write failing tests for incident transitions, deduplication, stale completion, owner isolation, delivery retries and revoked tokens.
- [x] Add Drizzle tables/migration for capture state/events, devices and delivery outbox. Keep refresh history; only successful recapture resolves incidents.
- [x] Implement capture lifecycle recording for both generic and resolver paths. Intermediate failures remain retrying, not final notifications. Sanitize messages through stable error-code descriptions.
- [x] Implement authenticated event polling API, device registration/revocation, push capability/test APIs and a persistent FCM dispatcher. Retain reusable transport interface; notification failure cannot trigger crawl retries.
- [x] Implement Firebase Android build configuration, opt-in UI, token refresh, logout cleanup, foreground presentation and validated notification navigation. Missing Firebase configuration must not break non-push builds.
- [x] Align Web/APK incident display, add integration/security tests, run focused checks and document private Firebase configuration and acceptance tests.

Rules: No notification for ordinary success or intermediate automatic retries. Final failures and partial completion notify once per attempt; a previously failed/partial bookmark resolving fully emits recovered. Authentication failures in a short window are grouped by owner/platform. Unknown failures stay unknown. No raw response, cookie, signed asset URL, token or service-account material may enter an event/push/log. Events and dispatch status remain queryable even when no push credentials/devices exist. No build tags or production deployment are authorized in this task.

Credentials: User has not created a Firebase project. Complete implementation and mocked transport tests now; real device delivery requires later Firebase setup and a rebuilt APK. Do not claim live FCM verification without it.

## Verification (2026-11-03)

- Verification uses Node 24 and current dependencies in the upstream-v0341 verification worktree; modified source is synchronized from the development checkout.
- Shared-server: 39 tests; workers: 108 tests; tRPC: 495 tests; mobile: 35 tests; web: 62 tests. All passed. Web excludes generated `.next/**` tests and uses a 20-second test timeout; the initial default run picked up a generated migration script and timed out on sign-up.
- TypeScript checks passed for shared-server, workers, tRPC, API, web and mobile. Scoped oxlint and oxfmt checks passed after final formatting.
- Android Expo prebuild passed with a fake public Firebase config, without installing or compiling Android dependencies. Generated manifest includes the capture channel and disables automatic Firebase messaging initialization. Client config checks reject private service-account files.
- Migration regeneration reports no schema changes. No SQLite/base-image version change is included.
- Read-only review findings on video false-success outcomes, revoked devices and stale leases were fixed with regression tests and reviewed again.
- No actual FCM send, new APK build, updated preview UI deployment or production deployment has been performed. These remain acceptance steps after Firebase configuration and release approval.
