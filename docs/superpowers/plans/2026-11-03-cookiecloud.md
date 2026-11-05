# CookieCloud Implementation Plan

Goal: Synchronize Xiaohongshu and Douyin browser cookies without restarting resolvers.

Architecture: Admin-only global settings in the existing config table; local decryption in shared-server; existing runtime-secret persistence and dispatch; worker-owned cron scheduling. Manual and automatic writes share a database lease and use last-successful-write semantics. Secrets are never returned to the UI.

- [x] Add regression tests for current CookieCloud encryption, cookie selection, validation, and failed/partial sync.
- [x] Implement shared settings, local decryption, bounded requests, and serialized runtime-secret updates.
- [x] Expose admin settings/status/sync procedures and a background scheduler.
- [x] Add settings controls for hourly, six-hourly, twelve-hourly, daily, and five-field cron schedules with an explicit timezone.
- [x] Run focused tests, type/lint/format checks, document configuration and limitations.

Validation: 493 tRPC tests, 103 workers tests, 20 shared-server tests, and two existing settings UI tests passed using the v0.34.1 verification worktree's installed dependencies. Web/workers/shared-server/tRPC typechecks passed; changed files passed oxlint/oxfmt and diff checks. Playwright verified saved custom cron, password masking and desktop/390px layouts against an isolated `/tmp` database. Live CookieCloud credentials were not supplied, so real-server interoperability remains a deployment acceptance check.

Acceptance: Manual writes remain available and are overwritten by the next successful cloud sync even when cloud contents are unchanged. Empty/malformed/expired data and failed downloads never erase stored cookies. Independent platform failures are reported separately. WeChat service authentication is unaffected. No real credentials, deployment, commits, or build tags are part of this task.
