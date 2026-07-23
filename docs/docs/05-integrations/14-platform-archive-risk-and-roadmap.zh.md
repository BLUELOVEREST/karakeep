---
title: 第三方平台离线归档风险与后续计划
---

# 第三方平台离线归档风险与后续计划

本文档记录当前 Karakeep fork 中第三方平台解析与离线归档的状态、风险项、测试重点和后续值得补齐的功能。

## 1. 当前目标

当前项目目标不是简单保存链接，而是尽量做到：

- 普通网页使用 Karakeep 原生 crawler、PDF、截图、完整网页归档能力。
- 第三方平台链接使用平台专用 resolver/downloader 获取真实内容。
- 正文、图片、视频等关键素材最终归入 Karakeep 本地 asset 存储。
- Karakeep 前端仍然按原生 link bookmark 展示，避免为每个平台单独做一套 UI。

测试和部署时建议默认开启：

```env
CRAWLER_FULL_PAGE_ARCHIVE=true
CRAWLER_VIDEO_DOWNLOAD=true
CRAWLER_DOWNLOAD_BANNER_IMAGE=true
CRAWLER_STORE_SCREENSHOT=true
```

## 2. 当前已接入能力

### 普通网页

普通网页仍走 Karakeep 原生 crawler。

当前能力：

- 保存标题、描述、作者、原始 URL。
- 保存 readable `htmlContent`。
- 正文过大时保存为 `LINK_HTML_CONTENT` asset。
- 可保存封面图 `LINK_BANNER_IMAGE`。
- 可保存截图 `LINK_SCREENSHOT`。
- 可保存 PDF `LINK_PDF`。
- 可保存完整网页归档 `LINK_FULL_PAGE_ARCHIVE`。

主要控制参数：

```env
CRAWLER_FULL_PAGE_ARCHIVE=true
CRAWLER_STORE_PDF=false
CRAWLER_STORE_SCREENSHOT=true
CRAWLER_DOWNLOAD_BANNER_IMAGE=true
```

### 小红书

当前能力：

- Karakeep 根据小红书域名选择 Spider_XHS 或 xiaohongshu-mcp。
- `/api/xhs/note` 只做解析，不下载媒体。
- 图文笔记图片会作为 `archivableAssets` 进入 Karakeep 统一图片归档流程。
- Karakeep 会把图文正文里的远程图片 URL 替换成 `/api/assets/<assetId>`。
- 视频笔记通过 `CRAWLER_VIDEO_DOWNLOAD=true` 触发 `videoWorker`。
- `videoWorker` 调用 Spider_XHS `/api/xhs/download`，导入封面为 `LINK_BANNER_IMAGE`，导入视频为 `LINK_VIDEO`。

当前仍需关注：

- `xhslink.com` 短链在 Karakeep 侧会识别，但 Spider_XHS 当前可能仍只接受最终小红书笔记页 URL。测试阶段需要重点验证短链。
- 视频笔记封面不在 resolver 阶段归档，避免和 `/api/xhs/download` 重复下载。

### 抖音

当前能力：

- Karakeep `videoWorker` 根据抖音域名调用外部 `douyin-downloader`。
- 外部服务下载视频到共享 staging 目录。
- Karakeep 从本地 path 导入视频为 `LINK_VIDEO`。

当前仍需关注：

- 抖音封面、图集、正文结构化资产是否完整，取决于 `douyin-downloader` 当前返回协议。
- 当前核心能力是视频本体离线保存。

### 酷安

当前能力：

- Karakeep 根据酷安域名调用外部 Coolapk resolver。
- resolver 返回标题、正文、作者、图片 URL。
- 图片会作为 `archivableAssets` 进入统一图片归档流程。
- Karakeep 会把正文里的远程图片 URL 替换成 `/api/assets/<assetId>`。

当前仍需关注：

- 如果酷安图片需要特殊 Cookie/Header，Karakeep 直接下载远程图片可能失败。必要时应改为 Coolapk resolver/downloader 先下载到共享 staging 目录，再由 Karakeep 导入。

### 什么值得买

当前能力：

- Karakeep 根据 `post.smzdm.com` / `post.m.smzdm.com` 文章链接调用外部 SMZDM resolver。
- resolver 返回标题、正文、作者、发布时间、封面、正文图片。
- 图片会作为 `archivableAssets` 进入统一图片归档流程。
- Karakeep 会把正文里的远程图片 URL 替换成 `/api/assets/<assetId>`。

当前仍需关注：

- SMZDM 站点可能触发风控、验证码、限流。
- 如果图片下载需要平台特定 Header，后续应让 SMZDM resolver/downloader 负责下载到 staging 目录。

### 微信公众号

当前能力：

- Karakeep 新增 `WechatArticleProvider`。
- `mp.weixin.qq.com/s/...` 会被识别为微信公众号文章。
- Karakeep 调用外部 `wechat-article-exporter` 改造接口。
- 返回的封面和正文图片会进入统一图片归档流程。
- 正文里的微信图片 URL 会替换成 `/api/assets/<assetId>`。

当前仍需关注：

- Karakeep 侧 provider 已接入，但外部 `wechat-article-exporter` 改造服务还需要真实联调。
- 微信图片可能依赖代理、登录态或防盗链，测试阶段要重点验证图片是否能被 Karakeep 直接下载。

## 3. 高优先级风险

### 3.1 Docker 共享目录路径不一致

第三方 downloader 返回的是容器内本地 path，例如：

```text
/import-staging/xhs/video123/video.mp4
```

Karakeep worker 必须能在自己的容器内读取同一个 path。否则会出现：

```text
Spider_XHS 下载成功
Karakeep 导入失败，提示文件不存在
```

要求：

- Karakeep worker 和第三方服务挂载同一个宿主机目录。
- 两边容器内路径保持一致，例如都挂载为 `/import-staging`。
- 第三方服务只写 staging 目录，不直接写 Karakeep asset storage。

### 3.2 正文 URL 替换不是严格 HTML 解析

当前正文 URL 替换使用字符串替换，能覆盖常见 markdown/html：

```md
![image](https://example.com/a.jpg)
```

```html
<img src="https://example.com/a.jpg">
```

但可能漏掉：

- `srcset`
- lazy-load 字段
- 被 HTML entity 转义的 URL
- 平台脚本动态加载的图片
- CSS background image

测试时要检查详情页里是否还残留远程图片 URL。

### 3.3 平台图片下载可能需要特殊 Header

当前统一图片归档流程支持两种来源：

- `url`: Karakeep 直接下载远程图片。
- `path`: 第三方服务已下载到 staging，Karakeep 直接导入本地文件。

对于反爬或防盗链严格的平台，推荐走 `path`，不要让 Karakeep 直接下载远程 URL。

### 3.4 第三方 resolver 失败不能回退通用 crawler

对于小红书、SMZDM、微信这类平台，如果专用 resolver 失败，不能自动回退普通网页爬取。否则很容易保存：

- 登录页
- 验证码页
- 风控页
- 空壳页面

当前这些平台应保持 `fail_fast`。

### 3.5 staging 目录残留

当前设计中，Karakeep 成功导入本地 path 后会删除对应文件。

仍需后续补齐：

- 导入失败时保留多久。
- 是否定期清理过期 staging 文件。
- 是否记录失败文件路径方便排查。

## 4. 测试重点

每个平台至少准备一条真实链接。

测试项：

- 收藏后列表页有标题、描述、封面。
- 详情页正文能打开。
- 正文图片地址已经替换为 `/api/assets/<assetId>`。
- 断网或阻断外网后，正文和图片仍可展示。
- 视频平台能生成 `LINK_VIDEO`。
- 小红书视频能同时生成 `LINK_BANNER_IMAGE` 和 `LINK_VIDEO`。
- `CRAWLER_FULL_PAGE_ARCHIVE=true` 时普通网页生成 `LINK_FULL_PAGE_ARCHIVE`。
- 第三方平台 resolver 失败时不会保存验证码页。
- staging 目录成功导入后不残留大文件。

建议测试命令：

```bash
pnpm --filter @karakeep/workers exec vitest run \
  workers/linkResolver/mediaArchive.test.ts \
  workers/linkResolver/providers/coolapk.test.ts \
  workers/linkResolver/providers/smzdm.test.ts \
  workers/linkResolver/providers/spiderXhs.test.ts \
  workers/linkResolver/providers/xiaohongshuMcp.test.ts \
  workers/linkResolver/providers/wechatArticle.test.ts \
  workers/linkResolver/registry.test.ts \
  workers/videoDownloader/xiaohongshu.test.ts \
  workers/videoDownloader/douyin.test.ts
```

```bash
pnpm --filter @karakeep/workers typecheck
pnpm --filter @karakeep/shared typecheck
pnpm --filter @karakeep/workers lint
pnpm --filter @karakeep/workers format
```

## 5. 值得后续补齐的功能

### 5.1 统一平台归档协议

建议所有第三方服务逐步统一返回：

```json
{
  "success": true,
  "title": "标题",
  "contentMarkdown": "正文",
  "contentHtml": "<article>正文</article>",
  "images": [
    {
      "url": "https://remote/image.jpg",
      "path": "/import-staging/platform/item/image_0.jpg",
      "originalUrl": "https://remote/image.jpg",
      "mimeType": "image/jpeg",
      "role": "content",
      "index": 0
    }
  ],
  "videos": [
    {
      "path": "/import-staging/platform/item/video.mp4",
      "mimeType": "video/mp4",
      "role": "content"
    }
  ]
}
```

原则：

- 能直接由 Karakeep 下载的图片可以只返回 `url`。
- 需要 Cookie/Header/签名的平台素材应由第三方服务下载，并返回 `path`。
- Karakeep 是最终资产归档方。

### 5.2 资产去重

后续可增加：

- 第三方服务返回 `sha256` 和 `sizeBytes`。
- Karakeep 导入前检查是否已有相同 hash。
- 相同文件复用已有 asset，减少重复存储。

### 5.3 平台归档状态页

建议后续在前端展示：

- resolver 是否成功。
- 图片下载成功数量。
- 图片下载失败数量。
- 视频下载状态。
- 完整网页归档状态。
- 失败原因。

### 5.4 重新归档按钮

用于这些场景：

- Cookie 更新后重新抓取。
- 之前平台风控失败。
- 新版 resolver 修复了解析问题。
- 原来只保存元数据，现在想补全素材。

### 5.5 短链展开

建议优先补：

- 小红书 `xhslink.com`
- 抖音 `v.douyin.com`
- 酷安分享短链

短链展开最好放在对应第三方 resolver 服务内，因为它们更清楚平台跳转、Cookie 和风控。

## 6. 当前结论

当前 Karakeep fork 已经从“只保存第三方平台解析结果”推进到“第三方平台图片进入本地 asset 归档流程”。

但测试阶段仍必须逐个平台验证真实链接，因为真正影响完整性的因素通常来自：

- 平台反爬。
- 图片防盗链。
- Cookie 失效。
- Docker 共享目录配置错误。
- 正文里存在未替换的特殊图片 URL。

下一步建议先完成 Docker 部署联调，再按平台做真实链接端到端测试。
