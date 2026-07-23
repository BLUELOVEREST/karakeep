---
title: SMZDM Resolver Research
---

# SMZDM Resolver Research

This document records candidate approaches for building an external resolver for
`post.smzdm.com` article links.

The goal is to support this Karakeep workflow:

```text
User saves https://post.smzdm.com/p/...
  -> Karakeep detects the SMZDM domain
  -> Karakeep calls an external SMZDM resolver
  -> Resolver returns title, body, images, author, published time, and metadata
  -> Karakeep stores the article and downloads assets
```

Karakeep should not implement SMZDM scraping internally. SMZDM-specific
headers, cookies, anti-crawler behavior, API experiments, and HTML parsing
should live in a separate resolver service.

## Current Finding

No mature open source project was found that directly solves "parse one SMZDM
article URL into full article content and images".

Most available projects or code snippets cover one of these narrower cases:

- SMZDM RSS/list routes.
- Ranking or hot-list scraping.
- User scripts that enhance the SMZDM web UI.
- Check-in/account automation.
- Official open API documentation that is not generally available to individual
  users.

Because of this, the practical direction is to create a lightweight
`smzdm-resolver` project and use known public or semi-public endpoints as
parsing experiments.

## Useful References

### RSSHub SMZDM Routes

Reference:

- <https://rsshub-doc.pages.dev/shopping#%E4%BB%80%E4%B9%88%E5%80%BC%E5%BE%97%E4%B9%B0>
- <https://github.com/DIYgod/RSSHub>

RSSHub supports SMZDM routes such as:

- `/smzdm/keyword/:keyword`
- `/smzdm/ranking/:rank_type/:rank_id/:hour`
- `/smzdm/haowen/:day?`
- `/smzdm/haowen/fenlei/:name/:sort?`
- `/smzdm/article/:uid`
- `/smzdm/baoliao/:uid`

Usefulness:

- Good for discovery, feeds, category pages, user article lists, and reference
  selectors.
- Not enough for the core Karakeep use case if it only receives one existing
  article URL.

Recommendation:

- Do not use RSSHub as the primary single-article resolver.
- Keep RSSHub as a possible future source for discovery/subscription features.

### Official SMZDM Open API

Reference:

- <https://openapi.zhidemai.com/pages/article/1.%E7%A4%BE%E5%8C%BA%E6%96%87%E7%AB%A0%E4%BF%A1%E6%81%AF%E8%AF%A6%E6%83%85%E6%8E%A5%E5%8F%A3.html>

The documented article detail endpoint is:

```text
v1/article/detail/show
```

The documented request parameter includes:

```text
article_ids=aoxmmdm9
```

Usefulness:

- This is structurally the best source if credentials are available.
- It should return stable article metadata and content fields.

Problem:

- The open API appears to require platform access and is likely not usable by
  individual private deployments.

Recommendation:

- Do not make this the first implementation path.
- Keep the response model as a useful reference for naming fields.
- If API access becomes available later, add it as the highest-priority backend.

### User Script Endpoint: long_article

Reference:

- <https://gist.github.com/ywwzwb/f36668d01dd4b188839acb490e627661>
- <https://greasyfork.icu/zh-CN/scripts/453622-%E4%BB%80%E4%B9%88%E5%80%BC%E5%BE%97%E4%B9%B0-%E8%90%A5%E9%94%80%E5%8F%B7%E5%B1%8F%E8%94%BD%E5%99%A8/code>

The user script uses:

```http
POST https://post.smzdm.com/api/cards/detail/long_article
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
```

Request body:

```text
article_id=awm04krm
```

The script uses this endpoint to read category data from:

```text
data.data.tongji_data.main_category
```

Usefulness:

- This is the most promising non-official endpoint found so far.
- It accepts the short article ID found in SMZDM article URLs.
- It may return more article detail data than the user script currently uses.

Unknowns to test:

- Whether it returns full article body.
- Whether it returns all images.
- Whether it requires login cookies.
- Whether it requires a browser-like `Referer`.
- Whether it blocks NAS/server IPs more aggressively than residential browser
  traffic.
- Whether it returns verification or rate-limit pages under repeated requests.

Recommended first experiment:

```bash
curl -i \
  -X POST \
  'https://post.smzdm.com/api/cards/detail/long_article' \
  -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
  -H 'Referer: https://post.smzdm.com/p/awm04krm/' \
  -H 'User-Agent: Mozilla/5.0' \
  --data 'article_id=awm04krm'
```

If this returns useful JSON, inspect:

- top-level `error_code`, `error_msg`, `data`
- title fields
- author fields
- publish time fields
- article body fields
- image fields
- category/tag fields
- statistics fields

### Mobile Article Page

Candidate URLs:

```text
https://post.m.smzdm.com/p/awm04krm/
https://post.smzdm.com/p/awm04krm/
```

Usefulness:

- Mobile pages often contain simpler HTML or embedded JSON.
- They may be less JavaScript-heavy than desktop pages.

Unknowns to test:

- Whether the mobile page returns real content without verification.
- Whether article content is server-rendered.
- Whether images are lazy-loaded and need URL normalization.
- Whether full content is hidden behind scripts or APIs.

Recommended experiment:

```bash
curl -i \
  -H 'User-Agent: Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' \
  -H 'Referer: https://post.smzdm.com/p/awm04krm/' \
  'https://post.m.smzdm.com/p/awm04krm/'
```

Look for:

- `<article>` or article body containers.
- JSON-LD.
- `window.__INITIAL_STATE__` or similar embedded state.
- `article_id`, title, author, publish time.
- `data-src`, `src`, or image lazy-load attributes.

### Desktop HTML Page

Candidate URL:

```text
https://post.smzdm.com/p/awm04krm/
```

Usefulness:

- Direct HTML parsing is the simplest fallback when no API works.

Problem:

- Previous Crawl4AI testing returned only a verification/rate-limit page:

```text
Refreshing too often
Verification Code will refresh in 2 sec.
```

Recommendation:

- Use direct HTML only after API/mobile-page attempts fail.
- Detect verification pages explicitly and return `RATE_LIMITED` or
  `ANTI_BOT_BLOCKED`.
- Do not save verification text as article content.

### Check-In And App Automation Projects

Examples:

- `smzdm_bot` and similar scripts.

Usefulness:

- They may contain SMZDM app signing, Android headers, cookie extraction, and
  request conventions.

Problem:

- They are mostly for account check-in, lottery, rewards, or user automation.
- They are not article parsers.

Recommendation:

- Do not use them as article resolver foundations.
- Borrow request signing or app header ideas only if web endpoints fail.

## Recommended Resolver Architecture

Build a new standalone service, for example:

```text
eric-smzdm-resolver
```

Suggested internal backend order:

```text
1. official_openapi      optional, only if credentials are configured
2. long_article_api      first practical backend
3. mobile_html           fallback
4. desktop_html          fallback
5. browser_rendered_html optional last resort
```

Each backend should return the same normalized model. The service can choose the
first successful backend.

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

Resolve article:

```http
POST /api/smzdm/article
Content-Type: application/json
```

Request:

```json
{
  "url": "https://post.smzdm.com/p/awm04krm/"
}
```

Success response:

```json
{
  "success": true,
  "source": "smzdm",
  "backend": "long_article_api",
  "url": "https://post.smzdm.com/p/awm04krm/",
  "finalUrl": "https://post.smzdm.com/p/awm04krm/",
  "articleId": "awm04krm",
  "title": "文章标题",
  "author": {
    "id": "123456",
    "name": "作者昵称",
    "avatar": "https://..."
  },
  "summary": "文章摘要",
  "publishedAt": "2026-07-21T00:00:00.000Z",
  "contentMarkdown": "# 文章标题\n\n正文...",
  "contentHtml": "<article>...</article>",
  "contentText": "纯文本正文",
  "coverImageUrl": "https://...",
  "images": [
    {
      "url": "https://...",
      "originalUrl": "https://...",
      "alt": "图片说明",
      "index": 0
    }
  ],
  "tags": ["数码", "NAS"],
  "categories": ["电脑数码"],
  "stats": {
    "likes": 0,
    "comments": 0,
    "favorites": 0
  },
  "raw": {}
}
```

Failure response:

```json
{
  "success": false,
  "source": "smzdm",
  "backend": "long_article_api",
  "url": "https://post.smzdm.com/p/awm04krm/",
  "articleId": "awm04krm",
  "reason": "ANTI_BOT_BLOCKED",
  "message": "SMZDM returned a verification page.",
  "retryable": true,
  "raw": {}
}
```

Recommended failure reasons:

- `INVALID_URL`: URL is not a supported SMZDM article URL.
- `ARTICLE_ID_NOT_FOUND`: Article ID cannot be extracted from URL.
- `ARTICLE_UNAVAILABLE`: Article was deleted or hidden.
- `ANTI_BOT_BLOCKED`: Verification or anti-bot page detected.
- `RATE_LIMITED`: Requests are too frequent.
- `AUTH_REQUIRED`: Cookie/login is required.
- `PARSE_FAILED`: Response was fetched but content extraction failed.
- `UPSTREAM_ERROR`: Unexpected upstream response or network error.

## URL Parsing Rules

Supported article URL patterns:

```text
https://post.smzdm.com/p/awm04krm/
https://post.m.smzdm.com/p/awm04krm/
```

Article ID extraction:

```text
/p/{article_id}/
```

The parser should normalize mobile URLs to canonical desktop URLs when possible:

```text
https://post.smzdm.com/p/{article_id}/
```

## Karakeep Configuration

Start the external resolver first:

```bash
uvicorn smzdm_resolver.app:app --host 0.0.0.0 --port 18063
```

For local non-Docker testing:

```bash
SMZDM_RESOLVER_ENDPOINT=http://127.0.0.1:18063/api/smzdm/article
```

For Docker Compose, use the resolver service name:

```bash
SMZDM_RESOLVER_ENDPOINT=http://smzdm-resolver:18063/api/smzdm/article
```

Karakeep routes these article URL patterns to the SMZDM provider when
`SMZDM_RESOLVER_ENDPOINT` is configured:

```text
https://post.smzdm.com/p/{article_id}/
https://post.m.smzdm.com/p/{article_id}/
```

If `SMZDM_RESOLVER_ENDPOINT` is not configured, Karakeep still detects SMZDM
article URLs and returns a fail-fast resolver error. It does not fall back to the
generic crawler, because SMZDM can return WAF, verification, or rate-limit pages
that must not be saved as real article content.

## Content Mapping For Karakeep

Karakeep maps resolver fields like this:

- `title` -> bookmark title
- `summary` or first paragraph -> bookmark description
- `author.name` -> article author
- `publishedAt` -> published time
- `finalUrl` -> canonical URL
- `coverImageUrl` or first image -> bookmark image
- `contentMarkdown` -> readable archived content
- `contentHtml` -> optional high-fidelity archive
- `contentText` -> fallback description when summary is absent

`images[]`, `tags[]`, `categories[]`, `stats`, and `raw` remain available in the
external resolver response. The current Karakeep link resolver maps only the
fields supported by Karakeep's `ResolvedLinkContent` interface.

## Testing Strategy

The resolver project should support command-line testing without starting
Karakeep:

```bash
python -m smzdm_resolver "https://post.smzdm.com/p/awm04krm/"
```

And HTTP testing:

```bash
curl -s \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://post.smzdm.com/p/awm04krm/"}' \
  http://127.0.0.1:18063/api/smzdm/article
```

Minimum test cases:

- Valid desktop article URL.
- Valid mobile article URL.
- Invalid domain.
- URL without article ID.
- API returns rate limit or verification text.
- API returns JSON without body.
- HTML page contains body and images.
- HTML page contains verification text.

## Development Notes

Start lightweight:

- Python + FastAPI is enough for the first resolver.
- Use `httpx` or `requests` for HTTP.
- Use `beautifulsoup4` or `lxml` for fallback HTML parsing.
- Return JSON only.
- Do not include Playwright in the first version unless all HTTP approaches
  fail.

Add optional browser rendering later only if needed:

- Playwright or Browserless can handle JavaScript-rendered pages.
- It increases memory usage and deployment complexity.
- It may still fail if SMZDM blocks server IPs or requests verification.

## Acceptance Criteria For First Resolver

The SMZDM resolver is good enough for Karakeep integration when:

- It accepts one `post.smzdm.com/p/...` URL.
- It returns title and non-empty article content for a real article.
- It returns image URLs in article order when images exist.
- It detects anti-bot pages and does not return them as article content.
- It exposes both CLI and HTTP test entry points.
- It returns structured failures with `reason`, `message`, and `retryable`.
- It can be packaged as Docker later.
