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
