---
title: Douyin Video Resolver
---

# Douyin Video Resolver

Karakeep can use an external
[`douyin-downloader`](https://github.com/jiji262/douyin-downloader) service for
Douyin video archiving.

This integration is part of the video download worker, not the article link
resolver system. Generic video URLs still use Karakeep's built-in `yt-dlp`
path. Douyin URLs use the external resolver only when
`DOUYIN_RESOLVER_ENDPOINT` is configured.

## Resolver Service

Start the adapted `douyin-downloader` service:

```bash
python run.py -c config.yml --serve --serve-host 0.0.0.0 --serve-port 18064
```

The service must expose:

```http
POST /api/karakeep/v1/douyin/download
GET /api/karakeep/v1/douyin/jobs/{jobId}
```

The endpoint base URL should not include `/download` or `/jobs/{jobId}`.

## Shared Volume

Karakeep imports the completed video file from the path returned by
`douyin-downloader`. Both containers must see the same path.

Recommended Docker Compose volume shape:

```yaml
services:
  karakeep-workers:
    volumes:
      - ./data/douyin:/downloads

  douyin-downloader:
    volumes:
      - ./data/douyin:/downloads
      - ./douyin-config.yml:/app/config.yml:ro
```

`douyin-downloader` config:

```yaml
path: /downloads
```

Karakeep copies the returned video file into its own temporary directory before
saving it as an asset. This prevents Karakeep from deleting the original file in
the shared Douyin download directory.

## Karakeep Configuration

Enable video download:

```bash
CRAWLER_VIDEO_DOWNLOAD=true
```

Configure the Douyin resolver:

```bash
DOUYIN_RESOLVER_ENDPOINT=http://douyin-downloader:18064/api/karakeep/v1/douyin
```

For local non-Docker testing:

```bash
DOUYIN_RESOLVER_ENDPOINT=http://127.0.0.1:18064/api/karakeep/v1/douyin
```

The video worker uses `CRAWLER_VIDEO_DOWNLOAD_TIMEOUT_SEC` as the maximum time
to wait for the external Douyin job to finish.

## URL Routing

When `DOUYIN_RESOLVER_ENDPOINT` is configured, Karakeep routes these hosts to
the external Douyin resolver:

- `douyin.com`
- `*.douyin.com`
- `iesdouyin.com`
- `*.iesdouyin.com`

The adapted `douyin-downloader` service is responsible for rejecting unsupported
URL types. The first supported scope should be single video or gallery/note
links. User pages, collections, music pages, and live recording should be
rejected by the resolver's Karakeep endpoint to avoid unexpectedly large jobs.

## Download Flow

```text
Karakeep VideoWorker
  -> POST {DOUYIN_RESOLVER_ENDPOINT}/download
  -> poll GET {DOUYIN_RESOLVER_ENDPOINT}/jobs/{jobId}
  -> select first result.items[].files[] entry with type=video
  -> copy the shared-volume file into Karakeep tmp dir
  -> save it as LINK_VIDEO asset
```

If the external resolver fails, Karakeep logs the resolver reason and skips the
video download. It does not fall back to `yt-dlp` for the same Douyin URL.

## Expected Completed Job Shape

```json
{
  "success": true,
  "source": "douyin",
  "backend": "douyin-downloader",
  "jobId": "abc123",
  "status": "success",
  "result": {
    "items": [
      {
        "title": "作品标题",
        "files": [
          {
            "type": "video",
            "path": "/downloads/author/post/item.mp4",
            "name": "item.mp4",
            "mimeType": "video/mp4"
          }
        ]
      }
    ]
  }
}
```

Karakeep currently imports only the first `type: "video"` file. Cover images,
metadata JSON, comments JSON, and gallery images remain in the shared Douyin
download directory for now.

## Manual Test

Start `douyin-downloader`, then create a Karakeep bookmark with a Douyin video
URL. Watch the worker logs for:

```text
Imported Douyin video file from "/downloads/..." to "/tmp/video_downloads/..."
Finished downloading video from "https://..." and adding it to the database
```

If no video asset appears, verify:

- `CRAWLER_VIDEO_DOWNLOAD=true`
- `DOUYIN_RESOLVER_ENDPOINT` points to the endpoint base URL
- both containers can read the same `/downloads` path
- the Douyin resolver job response contains a `type: "video"` file
