---
title: 第三方平台离线归档 Docker 部署说明
---

# 第三方平台离线归档 Docker 部署说明

本文档说明 Karakeep 与第三方平台解析服务使用 Docker 部署时的推荐目录、网络、环境变量和测试步骤。

## 1. 核心原则

第三方服务和 Karakeep 的职责边界：

- 第三方服务负责平台登录态、签名、反爬、解析和必要的临时下载。
- Karakeep 负责最终资产存储、数据库记录、页面展示和生命周期管理。
- 第三方服务不要长期保存素材。
- 第三方服务不要直接写 Karakeep asset storage 内部目录。
- 需要平台 Cookie/Header 的素材，由第三方服务先下载到 staging 共享目录。
- Karakeep 从 staging 目录导入 asset 成功后，删除 staging 文件。

推荐流程：

```text
用户保存链接
  -> Karakeep 按域名选择 resolver
  -> resolver 返回正文和媒体列表
  -> Karakeep 导入图片为 asset，并替换正文 URL
  -> 如果是视频，videoWorker 调用平台 downloader
  -> downloader 写入 staging 目录
  -> Karakeep 导入视频/封面为 asset
  -> Karakeep 前端通过 /api/assets/<assetId> 展示本地资产
```

## 2. 推荐目录结构

宿主机目录建议：

```text
./data/
  karakeep/
    assets/
    db/
  import-staging/
    xhs/
    douyin/
    coolapk/
    smzdm/
    wechat/
  secrets/
    xhs_cookie
```

说明：

- `./data/karakeep` 是 Karakeep 自己的数据目录。
- `./data/import-staging` 是第三方服务和 Karakeep worker 共享的临时导入目录。
- `./data/secrets` 放 Cookie、token、auth key 等敏感配置。

## 3. 共享目录要求

Docker 容器默认文件系统相互隔离。

如果 Spider_XHS 容器内下载到：

```text
/import-staging/xhs/video123/video.mp4
```

Karakeep worker 容器也必须能用同一个路径读取：

```text
/import-staging/xhs/video123/video.mp4
```

因此两个容器应挂载同一个宿主机目录，并且容器内路径保持一致：

```yaml
volumes:
  - ./data/import-staging:/import-staging
```

不要出现这种情况：

```yaml
# 不推荐
spider-xhs:
  volumes:
    - ./data/import-staging:/downloads

karakeep-workers:
  volumes:
    - ./data/import-staging:/import-staging
```

原因是 Spider_XHS 返回 `/downloads/...`，但 Karakeep 容器里没有 `/downloads/...`。

## 4. Karakeep 关键环境变量

建议测试阶段开启：

```env
CRAWLER_FULL_PAGE_ARCHIVE=true
CRAWLER_VIDEO_DOWNLOAD=true
CRAWLER_DOWNLOAD_BANNER_IMAGE=true
CRAWLER_STORE_SCREENSHOT=true
CRAWLER_STORE_PDF=false
CRAWLER_VIDEO_DOWNLOAD_TIMEOUT_SEC=600
```

第三方平台 endpoint：

```env
XIAOHONGSHU_BACKEND=spider_xhs
XIAOHONGSHU_SPIDER_ENDPOINT=http://spider-xhs:18062/api/xhs/note
XIAOHONGSHU_SPIDER_DOWNLOAD_ENDPOINT=http://spider-xhs:18062/api/xhs/download

DOUYIN_RESOLVER_ENDPOINT=http://douyin-downloader:18064/api/karakeep/v1/douyin

COOLAPK_RESOLVER_ENDPOINT=http://coolapk-resolver:18062/api/coolapk/feed

SMZDM_RESOLVER_ENDPOINT=http://smzdm-resolver:18063/api/smzdm/article

WECHAT_ARTICLE_RESOLVER_ENDPOINT=http://wechat-article-exporter:3000/api/karakeep/v1/wechat/article
WECHAT_ARTICLE_AUTH_KEY=your_auth_key
```

说明：

- `CRAWLER_FULL_PAGE_ARCHIVE=true` 控制普通网页完整网页归档。
- `CRAWLER_VIDEO_DOWNLOAD=true` 控制 video worker 是否下载视频。
- 第三方 resolver 失败时应 `fail_fast`，不要回退普通网页 crawler。
- 第三方图片进入 Karakeep 统一图片 asset 归档流程。

## 5. Spider_XHS 配置

Spider_XHS 建议配置：

```env
XHS_COOKIE_FILE=/run/secrets/xhs_cookie
XHS_DOWNLOAD_DIR=/import-staging/xhs
XHS_DOWNLOAD_TIMEOUT_SECONDS=120
```

挂载：

```yaml
volumes:
  - ./data/import-staging:/import-staging
  - ./data/secrets/xhs_cookie:/run/secrets/xhs_cookie:ro
```

健康检查：

```bash
curl http://127.0.0.1:18062/health
```

解析接口：

```bash
curl -s -X POST http://127.0.0.1:18062/api/xhs/note \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.xiaohongshu.com/explore/xxx?xsec_token=xxx"}' | jq
```

下载接口：

```bash
curl -s -X POST http://127.0.0.1:18062/api/xhs/download \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.xiaohongshu.com/explore/xxx?xsec_token=xxx","mediaTypes":["image","video"]}' | jq
```

成功返回的 `files[].path` 应该以 `/import-staging/xhs/` 开头。

## 6. docker-compose 示例

下面是示意配置，不是完整 Karakeep 官方 compose。实际部署时应合并到你当前的 compose 文件里。

```yaml
services:
  karakeep-web:
    image: ghcr.io/blueloverest/karakeep:latest
    environment:
      NEXTAUTH_URL: http://localhost:3000
      DATA_DIR: /data
    volumes:
      - ./data/karakeep:/data
    ports:
      - "3000:3000"
    depends_on:
      - karakeep-workers

  karakeep-workers:
    image: ghcr.io/blueloverest/karakeep:latest
    command: ["pnpm", "start:workers"]
    environment:
      DATA_DIR: /data
      CRAWLER_FULL_PAGE_ARCHIVE: "true"
      CRAWLER_VIDEO_DOWNLOAD: "true"
      CRAWLER_DOWNLOAD_BANNER_IMAGE: "true"
      CRAWLER_STORE_SCREENSHOT: "true"
      XIAOHONGSHU_BACKEND: spider_xhs
      XIAOHONGSHU_SPIDER_ENDPOINT: http://spider-xhs:18062/api/xhs/note
      XIAOHONGSHU_SPIDER_DOWNLOAD_ENDPOINT: http://spider-xhs:18062/api/xhs/download
      DOUYIN_RESOLVER_ENDPOINT: http://douyin-downloader:18064/api/karakeep/v1/douyin
      COOLAPK_RESOLVER_ENDPOINT: http://coolapk-resolver:18062/api/coolapk/feed
      SMZDM_RESOLVER_ENDPOINT: http://smzdm-resolver:18063/api/smzdm/article
      WECHAT_ARTICLE_RESOLVER_ENDPOINT: http://wechat-article-exporter:3000/api/karakeep/v1/wechat/article
      WECHAT_ARTICLE_AUTH_KEY: ${WECHAT_ARTICLE_AUTH_KEY}
    volumes:
      - ./data/karakeep:/data
      - ./data/import-staging:/import-staging
    depends_on:
      - spider-xhs
      - douyin-downloader
      - coolapk-resolver
      - smzdm-resolver
      - wechat-article-exporter

  spider-xhs:
    image: spider-xhs-karakeep:latest
    environment:
      XHS_COOKIE_FILE: /run/secrets/xhs_cookie
      XHS_DOWNLOAD_DIR: /import-staging/xhs
      XHS_DOWNLOAD_TIMEOUT_SECONDS: "120"
    volumes:
      - ./data/import-staging:/import-staging
      - ./data/secrets/xhs_cookie:/run/secrets/xhs_cookie:ro
    ports:
      - "18062:18062"

  douyin-downloader:
    image: douyin-downloader-karakeep:latest
    environment:
      DOUYIN_DOWNLOAD_DIR: /import-staging/douyin
    volumes:
      - ./data/import-staging:/import-staging
    ports:
      - "18064:18064"

  coolapk-resolver:
    image: coolapk-resolver-karakeep:latest
    environment:
      COOLAPK_DOWNLOAD_DIR: /import-staging/coolapk
    volumes:
      - ./data/import-staging:/import-staging
    ports:
      - "18065:18062"

  smzdm-resolver:
    image: smzdm-resolver-karakeep:latest
    environment:
      SMZDM_DOWNLOAD_DIR: /import-staging/smzdm
    volumes:
      - ./data/import-staging:/import-staging
    ports:
      - "18063:18063"

  wechat-article-exporter:
    image: wechat-article-exporter-karakeep:latest
    environment:
      WECHAT_EXPORT_DIR: /import-staging/wechat
      WECHAT_ARTICLE_AUTH_KEY: ${WECHAT_ARTICLE_AUTH_KEY}
    volumes:
      - ./data/import-staging:/import-staging
    ports:
      - "18066:3000"
```

注意：

- 镜像名需要替换成你实际构建出来的镜像。
- Karakeep 官方 compose 的命令和服务拆分可能与上面示例不同，合并时以当前项目实际 compose 为准。
- 所有第三方服务和 `karakeep-workers` 都挂载同一个 `/import-staging`。

## 7. 测试流程

### 7.1 启动前检查

检查目录：

```bash
mkdir -p ./data/karakeep
mkdir -p ./data/import-staging/{xhs,douyin,coolapk,smzdm,wechat}
mkdir -p ./data/secrets
```

检查 Cookie 和 auth key：

```bash
test -s ./data/secrets/xhs_cookie
```

### 7.2 启动服务

```bash
docker compose up -d
```

检查服务：

```bash
docker compose ps
```

检查 Spider_XHS：

```bash
curl http://127.0.0.1:18062/health
```

### 7.3 平台测试

每个平台保存一条真实链接：

- 普通网页文章。
- 小红书图文。
- 小红书视频。
- 抖音视频。
- 酷安动态。
- 什么值得买文章。
- 微信公众号文章。

每条链接检查：

- Karakeep 列表页是否有标题。
- Karakeep 详情页是否有正文。
- 正文图片是否是 `/api/assets/<assetId>`。
- 视频是否生成 `LINK_VIDEO`。
- 小红书视频是否生成本地封面。
- 普通网页是否生成 `LINK_FULL_PAGE_ARCHIVE`。
- `./data/import-staging` 是否没有长期残留大文件。

### 7.4 离线验证

为了验证是否真的离线，可以临时阻断外网或停止第三方服务，然后刷新 Karakeep 页面：

```bash
docker compose stop spider-xhs douyin-downloader coolapk-resolver smzdm-resolver wechat-article-exporter
```

预期：

- 已归档的正文仍然能看。
- 已归档的图片仍然从 `/api/assets/<assetId>` 加载。
- 已归档的视频仍然能播放。

## 8. 常见问题

### 8.1 Karakeep 报文件不存在

可能原因：

- 第三方服务和 Karakeep worker 没有挂载同一个 staging 目录。
- 两个容器内挂载路径不同。
- 第三方服务下载后过早删除文件。

处理：

- 确保两边都挂载 `./data/import-staging:/import-staging`。
- 确保第三方服务返回的 path 以 `/import-staging/...` 开头。

### 8.2 图片仍然是远程 URL

可能原因：

- resolver 没有返回图片列表。
- 图片 URL 在正文中被转义或出现在 `srcset` 等特殊字段。
- 图片下载失败，Karakeep 保留了原始正文 URL。

处理：

- 查看 worker 日志。
- 检查 resolver 返回的 `images` / `archivableAssets`。
- 必要时让第三方服务下载图片并返回本地 `path`。

### 8.3 视频没有保存

可能原因：

- `CRAWLER_VIDEO_DOWNLOAD=false`。
- 对应 downloader endpoint 未配置。
- 外部 downloader 下载失败。
- Karakeep 无法读取 staging path。

处理：

- 确认 `CRAWLER_VIDEO_DOWNLOAD=true`。
- 确认 `DOUYIN_RESOLVER_ENDPOINT` 或 `XIAOHONGSHU_SPIDER_DOWNLOAD_ENDPOINT`。
- 检查 downloader 日志和 Karakeep worker 日志。

### 8.4 FULL_PAGE_ARCHIVE 没有生成

可能原因：

- `CRAWLER_FULL_PAGE_ARCHIVE=false`。
- `monolith` 执行失败。
- 页面过大或超时。
- 用户存储配额不足。

处理：

- 确认 `CRAWLER_FULL_PAGE_ARCHIVE=true`。
- 适当增加 `CRAWLER_MONOLITH_TIMEOUT_SEC`。
- 检查 worker 日志。

## 9. 当前建议

测试阶段先不要继续接新平台。

推荐顺序：

1. 先跑普通网页完整归档。
2. 再跑小红书图文和视频。
3. 再跑抖音视频。
4. 再跑酷安和 SMZDM。
5. 最后联调微信公众号，因为它依赖外部 `wechat-article-exporter` 改造服务。

每个平台测试通过后，再考虑补短链、去重、归档状态页和重新归档按钮。
