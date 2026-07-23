---
title: yt-dlp Runtime Update Plan
---

# yt-dlp Runtime Update Plan

Karakeep already supports video archiving through
[`yt-dlp`](https://github.com/yt-dlp/yt-dlp). The Docker image downloads the
latest `yt-dlp` binary during image build, but the running container does not
update it automatically.

This document records a future design for updating `yt-dlp` inside the Docker
container without modifying the host system.

## Current Behavior

In Docker builds, Karakeep installs `yt-dlp` here:

```text
/usr/local/bin/yt-dlp
```

Video download is controlled by:

```bash
CRAWLER_VIDEO_DOWNLOAD=false
CRAWLER_VIDEO_DOWNLOAD_MAX_SIZE=50
CRAWLER_VIDEO_DOWNLOAD_TIMEOUT_SEC=600
CRAWLER_YTDLP_ARGS=
```

The current image-bundled binary is fixed after the Docker image is built. To
update it today, rebuild or pull a newer image.

## Problem

Video platforms such as Bilibili and Douyin frequently change their pages,
signing logic, or APIs. `yt-dlp` extractors may stop working until `yt-dlp` is
updated.

Rebuilding the whole Karakeep image for every `yt-dlp` update is reliable but
slow. Running `yt-dlp -U` directly against `/usr/local/bin/yt-dlp` inside the
container is also not ideal:

- It may require root or write permission to `/usr/local/bin`.
- It mutates the image-provided binary at runtime.
- A failed update can break the only available `yt-dlp` executable.
- It is less reproducible and harder to debug.

## Proposed Design

Keep the image-bundled binary as a fallback and maintain an optional managed
binary under Karakeep's data volume.

```text
/usr/local/bin/yt-dlp
  Image-bundled fallback binary.

/data/tools/yt-dlp/yt-dlp
  Runtime-managed binary downloaded by Karakeep when auto-update is enabled.
```

The video worker should prefer the managed binary if it exists and is
executable. Otherwise, it should fall back to `yt-dlp` from `PATH`.

## Proposed Configuration

```bash
CRAWLER_YTDLP_AUTO_UPDATE=false
CRAWLER_YTDLP_UPDATE_DIR=/data/tools/yt-dlp
CRAWLER_YTDLP_UPDATE_INTERVAL_HOURS=24
```

Default should remain `false` to keep current deployments reproducible.

## Update Flow

When workers start:

```text
1. If CRAWLER_YTDLP_AUTO_UPDATE is false, do nothing.
2. Read CRAWLER_YTDLP_UPDATE_DIR/last-check.json.
3. If last check is newer than CRAWLER_YTDLP_UPDATE_INTERVAL_HOURS, skip.
4. Detect CPU architecture.
5. Download the correct latest binary from GitHub releases:
   - amd64 -> yt-dlp_linux
   - arm64 -> yt-dlp_linux_aarch64
6. Write to a temporary file inside CRAWLER_YTDLP_UPDATE_DIR.
7. chmod +x the temporary file.
8. Run temporary binary with --version.
9. If validation passes, atomically rename it to yt-dlp.
10. Write last-check.json.
11. If any step fails, log a warning and keep using the fallback binary.
```

The update should happen at worker startup or on a low-frequency background
timer, not before every video download.

## Video Worker Execution

Current execution:

```text
execa("yt-dlp", args)
```

Future execution:

```text
const binary = await resolveYtDlpBinary()
execa(binary, args)
```

Resolution order:

```text
1. CRAWLER_YTDLP_UPDATE_DIR/yt-dlp if it exists and is executable.
2. "yt-dlp" from PATH.
```

## Failure Behavior

Auto-update must be non-blocking:

- Failed version check must not stop Karakeep startup.
- Failed download must not stop video downloading.
- Failed validation must discard the temporary file.
- Existing managed binary should remain untouched unless the new binary passes
  validation.
- If the managed binary later fails execution, the worker should log enough
  context to make fallback/debugging possible.

## Persistence

If `/data` is mounted as a Docker volume, the managed `yt-dlp` binary survives
container recreation.

If `/data` is not mounted, auto-update still works, but the binary is lost when
the container is recreated.

## Open Questions

- Whether to check GitHub release metadata first or simply download latest when
  the interval expires.
- Whether to expose the active `yt-dlp` path/version in logs or diagnostics.
- Whether to add a manual admin action for "update yt-dlp now".
- Whether to support a mirror URL for environments where GitHub downloads are
  slow or blocked.

## Acceptance Criteria

This feature is ready when:

- It is disabled by default.
- Enabling it updates only inside the container/data volume.
- It never modifies `/usr/local/bin/yt-dlp`.
- The image-bundled `yt-dlp` remains a fallback.
- Failed updates do not break video downloading.
- Tests cover binary selection, stale/fresh interval checks, successful update,
  failed update, and fallback behavior.
