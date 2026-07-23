---
title: WeChat Article Exporter Resolver
---

# WeChat Article Exporter Resolver

This document describes how to adapt
[`wechat-article-exporter`](https://github.com/wechat-article/wechat-article-exporter)
into a single-article resolver service for Karakeep.

The target use case is narrow: users save an existing
`https://mp.weixin.qq.com/s/...` article URL, Karakeep routes it to an external
resolver, and the resolver returns normalized article content plus image
metadata. Karakeep should not depend on WeChat-specific scraping code directly.

## Why Use A Separate Resolver

WeChat official account articles are platform-specific content, not ordinary
web pages. They may require special request headers, proxy nodes, image URL
rewriting, login/session handling, and retry logic.

Keep this logic outside Karakeep:

- Karakeep only classifies `mp.weixin.qq.com` links and calls an HTTP endpoint.
- `wechat-article-exporter` keeps WeChat-specific article download logic.
- If WeChat changes its page format or anti-crawler behavior, only the resolver
  needs to change.
- The resolver can be tested without starting Karakeep.

## Existing Upstream Capabilities

The upstream project already supports:

- Docker private deployment.
- REST API integration.
- Single article download by URL.
- Export formats including `html`, `markdown`, `text`, and `json`.
- Article image downloading through proxy nodes.
- Public proxy nodes and private proxy node configuration.

The upstream public API currently documents this single-article endpoint:

```http
GET /api/public/v1/download?url=ARTICLE_URL&format=json
X-Auth-Key: YOUR_AUTH_KEY
```

The auth key is generated after logging in and follows the login session
validity. The upstream documentation currently describes the session as valid
for 4 days.

## Desired Architecture

Run the adapted resolver as its own service:

```text
Karakeep
  -> detects mp.weixin.qq.com
  -> POST WECHAT_ARTICLE_RESOLVER_ENDPOINT
  -> adapted wechat-article-exporter service
  -> WeChat article page + proxy nodes
  -> normalized article JSON
  -> Karakeep bookmark content and assets
```

The first implementation can be a thin wrapper around upstream
`wechat-article-exporter`. Do not remove the upstream UI, account search, or
batch export features at this stage. Add one Karakeep-oriented endpoint and keep
the rest of the project intact so future upstream merges remain easier.

## Required New Endpoint

Add a new private API endpoint to the `wechat-article-exporter` fork:

```http
POST /api/karakeep/v1/wechat/article
Content-Type: application/json
X-Auth-Key: YOUR_AUTH_KEY
```

Request body:

```json
{
  "url": "https://mp.weixin.qq.com/s/QoMJ26hSXfEP4bHkbRSOHQ"
}
```

The endpoint should:

1. Validate the URL host.
2. Reuse the existing single-article download implementation.
3. Request the richest available format internally, preferably `json` plus
   `html` or `markdown` if the upstream implementation stores these separately.
4. Normalize the response into the contract below.
5. Return structured failures instead of HTML error pages.

## Response Contract

Successful response:

```json
{
  "success": true,
  "source": "wechat",
  "backend": "wechat-article-exporter",
  "url": "https://mp.weixin.qq.com/s/QoMJ26hSXfEP4bHkbRSOHQ",
  "finalUrl": "https://mp.weixin.qq.com/s/QoMJ26hSXfEP4bHkbRSOHQ",
  "title": "文章标题",
  "author": "作者",
  "accountName": "公众号名称",
  "accountId": "公众号 ID 或 biz",
  "summary": "摘要",
  "publishedAt": "2026-07-21T00:00:00.000Z",
  "contentMarkdown": "# 文章标题\n\n正文...",
  "contentHtml": "<article>...</article>",
  "contentText": "纯文本正文",
  "coverImageUrl": "https://mmbiz.qpic.cn/...",
  "images": [
    {
      "url": "https://mmbiz.qpic.cn/...",
      "originalUrl": "https://mmbiz.qpic.cn/...",
      "alt": "图片说明",
      "index": 0
    }
  ],
  "raw": {}
}
```

Failure response:

```json
{
  "success": false,
  "source": "wechat",
  "backend": "wechat-article-exporter",
  "url": "https://mp.weixin.qq.com/s/QoMJ26hSXfEP4bHkbRSOHQ",
  "reason": "AUTH_EXPIRED",
  "message": "X-Auth-Key is expired. Re-login to refresh the key.",
  "retryable": false,
  "raw": {}
}
```

Recommended `reason` values:

- `INVALID_URL`: The URL is not a supported WeChat article URL.
- `AUTH_MISSING`: `X-Auth-Key` was not provided.
- `AUTH_EXPIRED`: Login session or API key is expired.
- `PROXY_UNAVAILABLE`: No public or private proxy node is available.
- `RATE_LIMITED`: Public proxy quota or WeChat request limit was hit.
- `ARTICLE_UNAVAILABLE`: The article was deleted, private, or blocked.
- `PARSE_FAILED`: The article was fetched but content extraction failed.
- `UPSTREAM_ERROR`: Unexpected upstream error.

Use HTTP status codes only for transport-level meaning:

- `200`: Resolver completed and returns either `success: true` or
  `success: false`.
- `400`: Invalid request body.
- `401`: Missing or invalid auth key.
- `500`: Resolver bug or unexpected crash.
- `503`: Resolver dependency unavailable.

Karakeep should treat WeChat resolver failures as `fail_fast`. It should not
fall back to the generic webpage crawler, because generic crawling often saves a
WeChat error page, verification page, or incomplete article instead of the real
content.

## Field Mapping For Karakeep

Karakeep should map resolver fields like this:

- `title` -> bookmark title
- `summary` or first text paragraph -> bookmark description
- `author` -> article author
- `accountName` -> source publisher
- `publishedAt` -> published time
- `finalUrl` -> canonical/final URL
- `coverImageUrl` or first `images[]` item -> bookmark image
- `contentMarkdown` -> archived readable content
- `contentHtml` -> optional high-fidelity archive content
- `images[]` -> downloadable assets
- `raw` -> debug payload, stored only if needed

## Image Handling

The resolver should return image URLs and metadata. Karakeep will decide whether
to download images into its own asset storage.

Do not require Karakeep to understand WeChat image URL parameters. The resolver
should normalize image URLs enough that Karakeep can download them directly.

Recommended image rules:

- Preserve the original image order.
- Preserve both rewritten/downloadable URL and original URL when possible.
- Include cover image separately if the upstream parser exposes it.
- Do not inline image bytes in the JSON response.
- Do not return base64 images.
- Let Karakeep perform final asset downloading and storage.

## Proxy Nodes

`wechat-article-exporter` uses proxy nodes because WeChat article content and
images have cross-origin and anti-hotlinking restrictions. Public proxy nodes
have shared quota and can return `429` or become unavailable.

For private NAS deployment, configure private proxy nodes where possible:

```text
Karakeep -> wechat resolver -> private proxy node(s) -> WeChat article/images
```

The adapted endpoint should surface proxy problems explicitly:

```json
{
  "success": false,
  "reason": "PROXY_UNAVAILABLE",
  "message": "No available proxy node can download this article.",
  "retryable": true
}
```

If the failure is public quota exhaustion, return:

```json
{
  "success": false,
  "reason": "RATE_LIMITED",
  "message": "Proxy node quota exceeded.",
  "retryable": true
}
```

## Implementation Notes In The Fork

When modifying `wechat-article-exporter`, prefer additive changes:

1. Add a new server API route under an obvious Karakeep namespace.
2. Reuse the existing single article download function instead of duplicating
   fetch/parsing logic.
3. Add a small normalization layer that converts upstream article data into the
   response contract above.
4. Keep authentication compatible with upstream `X-Auth-Key`.
5. Keep the upstream UI and existing public API unchanged.
6. Add tests for the normalization layer if the upstream project has a test
   setup.

Avoid these changes in the first stage:

- Do not remove batch download features.
- Do not change upstream public API semantics.
- Do not move large modules.
- Do not make Karakeep depend on this service's internal TypeScript files.
- Do not return ZIP files to Karakeep for normal single-article saves.

This keeps the fork easy to compare with upstream and reduces future merge
conflicts.

## Local Manual Test

Start the adapted `wechat-article-exporter` service first.

Then verify the auth key:

```bash
curl -s \
  -H "X-Auth-Key: $WECHAT_ARTICLE_AUTH_KEY" \
  http://127.0.0.1:3000/api/public/v1/authkey
```

Test upstream single article download:

```bash
curl -s \
  -H "X-Auth-Key: $WECHAT_ARTICLE_AUTH_KEY" \
  "http://127.0.0.1:3000/api/public/v1/download?format=json&url=https%3A%2F%2Fmp.weixin.qq.com%2Fs%2FQoMJ26hSXfEP4bHkbRSOHQ"
```

Test the Karakeep-oriented endpoint:

```bash
curl -s \
  -H "Content-Type: application/json" \
  -H "X-Auth-Key: $WECHAT_ARTICLE_AUTH_KEY" \
  -d '{"url":"https://mp.weixin.qq.com/s/QoMJ26hSXfEP4bHkbRSOHQ"}' \
  http://127.0.0.1:3000/api/karakeep/v1/wechat/article
```

The response is ready for Karakeep only when:

- `success` is `true`.
- `title` is non-empty.
- At least one of `contentMarkdown`, `contentHtml`, or `contentText` is
  non-empty.
- `images` contains all article images in original order when the article has
  images.
- Failures return JSON with `reason`, `message`, and `retryable`.

## Future Karakeep Configuration

After this resolver endpoint is available, Karakeep can add:

```bash
WECHAT_ARTICLE_RESOLVER_ENDPOINT=http://wechat-article-exporter:3000/api/karakeep/v1/wechat/article
WECHAT_ARTICLE_AUTH_KEY=...
```

For local non-Docker testing:

```bash
WECHAT_ARTICLE_RESOLVER_ENDPOINT=http://127.0.0.1:3000/api/karakeep/v1/wechat/article
WECHAT_ARTICLE_AUTH_KEY=...
```

Karakeep should route these domains to the WeChat resolver:

- `mp.weixin.qq.com`
- `*.mp.weixin.qq.com`

## Acceptance Criteria

The `wechat-article-exporter` fork is ready for Karakeep integration when:

- A single WeChat article URL can be resolved through one HTTP request.
- The endpoint does not require browser UI interaction after login/auth key is
  configured.
- The response matches the success and failure contracts above.
- Image URLs are returned in article order.
- Proxy, auth, rate-limit, article deletion, and parse failures are explicit.
- The service can run locally and in Docker.
