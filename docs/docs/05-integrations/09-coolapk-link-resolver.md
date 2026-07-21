---
title: Coolapk Link Resolver
---

# Coolapk Link Resolver

Karakeep integrates Coolapk through an external HTTP resolver service. The
resolver lives in `/home/zhangzhicheng/workspace/own/eric-coolpak-spider` and
keeps Coolapk-specific request headers, app token logic, cookies, and parsing
outside the Karakeep worker process.

## Resolver Service

Start the Coolapk resolver:

```bash
coolapk-resolver
```

Or start it directly with Uvicorn:

```bash
uvicorn coolapk_spider.server:app --host 0.0.0.0 --port 18062
```

Optional cookie/login environment:

```bash
export COOLAPK_TOKEN='...'
export COOLAPK_USERNAME='...'
export COOLAPK_UID='...'
export COOLAPK_SESSID='...'
```

## HTTP Contract

Health check:

```http
GET /health
```

```json
{
  "status": "ok"
}
```

Resolve a feed/article:

```http
POST /api/coolapk/feed
Content-Type: application/json
```

Request by URL:

```json
{
  "url": "https://www.coolapk.com/feed/71896052"
}
```

Request by id:

```json
{
  "id": 71896052
}
```

Success response:

```json
{
  "success": true,
  "msg": "success",
  "feed": {
    "id": 71896052,
    "type": "动态",
    "title": "标题",
    "message": "正文内容",
    "author": {
      "uid": 536381,
      "username": "wherewhere",
      "avatar": "https://..."
    },
    "images": ["https://..."],
    "blocks": [
      { "type": "text", "text": "正文段落" },
      { "type": "image", "url": "https://...", "description": "图片说明" }
    ],
    "share_url": "https://www.coolapk.com/feed/71896052",
    "created_at": 1726069882,
    "stats": {
      "likes": 17,
      "comments": 1,
      "forwards": 1,
      "favorites": 0
    },
    "raw": {}
  }
}
```

Crawler-level failures return HTTP 200 with `success: false`:

```json
{
  "success": false,
  "msg": "Unable to extract Coolapk feed id from url",
  "feed": null
}
```

Karakeep treats these failures as `fail_fast` and does not fall back to the
generic webpage crawler. This avoids saving app landing pages or error pages as
real content.

## Karakeep Configuration

For local non-Docker testing:

```bash
COOLAPK_RESOLVER_ENDPOINT=http://127.0.0.1:18062/api/coolapk/feed
```

For Docker Compose, use the resolver service name:

```bash
COOLAPK_RESOLVER_ENDPOINT=http://coolapk-resolver:18062/api/coolapk/feed
```

Karakeep routes these domains to the Coolapk provider when
`COOLAPK_RESOLVER_ENDPOINT` is configured:

- `coolapk.com`
- `*.coolapk.com`
- `coolmarket.com.cn`
- `*.coolmarket.com.cn`

## Content Mapping

Karakeep maps the resolver response like this:

- `feed.title` -> bookmark title
- `feed.message` -> bookmark description
- `feed.author.username` -> author
- first image from `feed.blocks` or `feed.images` -> banner image
- `feed.share_url` -> final URL
- `feed.created_at` -> published time
- `feed.blocks` -> ordered Markdown content
- `feed.message + feed.images` -> fallback Markdown content

When `feed.blocks` exists, Karakeep preserves the text/image order:

```markdown
# 标题

正文段落

![图片说明](https://...)
```

If `feed.blocks` is absent, Karakeep falls back to:

```markdown
# 标题

正文内容

![image 1](https://...)
```

## Manual Test

Test the resolver first:

```bash
curl -s http://127.0.0.1:18062/health
```

```bash
curl -s \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.coolapk.com/feed/71896052"}' \
  http://127.0.0.1:18062/api/coolapk/feed
```

Then start Karakeep workers with `COOLAPK_RESOLVER_ENDPOINT` and save a Coolapk
feed URL through the normal bookmark flow.
