---
title: Custom Link Resolvers
---

# Custom Link Resolvers

This fork keeps platform-specific crawling outside the Karakeep main process.
Karakeep selects a resolver by URL domain, calls the external resolver, then
stores the normalized result in the existing bookmark/link tables and asset
store.

## Why External Services

Platform crawlers often need heavy dependencies, browser automation, cookies, or
account state. Keeping them as separate services prevents those dependencies
from making the Karakeep web and worker images larger or less stable. If a
platform crawler breaks because of anti-bot changes, normal webpages, uploads,
and PDF/image bookmarks can continue to work.

## Current Routing

The worker currently routes these domains to the Xiaohongshu resolver:

- `xiaohongshu.com`
- `*.xiaohongshu.com`
- `xhslink.com`
- `*.xhslink.com`

Generic webpages continue to use Karakeep's built-in crawler.

## Xiaohongshu

The preferred Xiaohongshu backend is an external `Spider_XHS` wrapper service.
Karakeep does not vendor the Spider_XHS source code. It calls a small HTTP
wrapper around Spider_XHS and stores the normalized result.

Set these environment variables for the worker:

```bash
XIAOHONGSHU_BACKEND=spider_xhs
XIAOHONGSHU_SPIDER_ENDPOINT=http://127.0.0.1:18061/api/xhs/note
```

The Spider_XHS wrapper endpoint should accept:

```http
POST /api/xhs/note
Content-Type: application/json
```

```json
{
  "url": "https://www.xiaohongshu.com/explore/<note-id>?xsec_token=<token>"
}
```

And return:

```json
{
  "success": true,
  "msg": "success",
  "note": {
    "title": "note title",
    "desc": "note body",
    "user": { "nickname": "author" },
    "image_list": [{ "url": "https://..." }]
  }
}
```

This maps naturally to Spider_XHS's Python API:

```python
success, msg, note = pc_api.get_note_info(note_url, cookies_str)
```

### Spider_XHS HTTP Wrapper Implementation

Add a thin HTTP service in the Spider_XHS project. The service should stay
stateless: Karakeep sends a Xiaohongshu URL, the wrapper loads the configured
cookie, calls Spider_XHS, and returns the raw note object.

Install the extra HTTP dependencies in the Spider_XHS Python environment:

```bash
pip install fastapi uvicorn
```

Create `server.py` in the Spider_XHS repository:

```python
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, HttpUrl

from xhs_utils.xhs_util import XHS_Apis


class NoteRequest(BaseModel):
    url: HttpUrl


app = FastAPI(title="Spider_XHS HTTP Wrapper")
pc_api = XHS_Apis()


def load_cookie() -> str:
    cookie = os.getenv("XHS_COOKIE", "").strip()
    if cookie:
        return cookie

    cookie_file = os.getenv("XHS_COOKIE_FILE", "").strip()
    if cookie_file:
        return Path(cookie_file).read_text(encoding="utf-8").strip()

    raise RuntimeError("Set XHS_COOKIE or XHS_COOKIE_FILE before starting the service")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/xhs/note")
def get_note(req: NoteRequest) -> dict[str, Any]:
    try:
        success, msg, note = pc_api.get_note_info(str(req.url), load_cookie())
        return {
            "success": bool(success),
            "msg": str(msg),
            "note": note if note is not None else None,
        }
    except Exception as exc:
        return {
            "success": False,
            "msg": f"{type(exc).__name__}: {exc}",
            "note": None,
        }
```

If the import path is different in your Spider_XHS checkout, adjust this line:

```python
from xhs_utils.xhs_util import XHS_Apis
```

The wrapper intentionally returns HTTP 200 for Spider_XHS-level failures and
uses `success: false`. Karakeep then marks the Xiaohongshu bookmark as failed
without falling back to the generic crawler. Reserve HTTP 5xx for wrapper
infrastructure failures.

Start the wrapper:

```bash
export XHS_COOKIE_FILE=/path/to/xhs-cookie.txt
uvicorn server:app --host 0.0.0.0 --port 18061
```

Or pass the cookie directly:

```bash
export XHS_COOKIE='a1=...; webId=...; web_session=...'
uvicorn server:app --host 0.0.0.0 --port 18061
```

Test the wrapper before connecting Karakeep:

```bash
curl -s http://127.0.0.1:18061/health
```

```bash
curl -s \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.xiaohongshu.com/explore/<note-id>?xsec_token=<token>"}' \
  http://127.0.0.1:18061/api/xhs/note
```

The response should contain `success: true` and a non-empty `note`. At minimum,
Karakeep currently reads:

- `note.title`
- `note.desc`, `note.description`, or `note.content`
- `note.user.nickname`
- `note.image_list[].url`, `note.image_list[].url_default`, or
  `note.image_list[].url_pre`

Configure Karakeep workers:

```bash
XIAOHONGSHU_BACKEND=spider_xhs
XIAOHONGSHU_SPIDER_ENDPOINT=http://spider-xhs:18061/api/xhs/note
```

For local non-Docker testing on the same machine, use:

```bash
XIAOHONGSHU_SPIDER_ENDPOINT=http://127.0.0.1:18061/api/xhs/note
```

For Docker Compose, run Spider_XHS as a separate service and point Karakeep's
worker container to the service name, not `127.0.0.1`.

`xiaohongshu-mcp` is still supported as an alternate backend:

```bash
XIAOHONGSHU_BACKEND=mcp
XIAOHONGSHU_MCP_ENDPOINT=http://127.0.0.1:18060/mcp
```

If `XIAOHONGSHU_BACKEND=auto`, Karakeep selects Spider_XHS when
`XIAOHONGSHU_SPIDER_ENDPOINT` is set, otherwise selects xiaohongshu-mcp when
`XIAOHONGSHU_MCP_ENDPOINT` is set.

## Failure Policy

Xiaohongshu uses `fail_fast`. If the external resolver is not configured, the
URL is marked as failed instead of falling back to the generic webpage crawler.
This avoids saving login pages, challenge pages, or empty shell pages as if they
were real content.

Generic webpages still use Karakeep's existing retry and fallback behavior.
