---
title: 当前项目功能与交接说明
---

# 当前项目功能与交接说明

本文档记录当前 Karakeep fork 以及外部 resolver 体系的功能、代码结构、部署方式、存储行为和已知问题。后续如果在其他机器或其他会话继续开发，应优先阅读本文档。

## 1. 项目目标

当前目标不是重新开发一个收藏系统，而是在 Karakeep 的基础上增强“离线收藏”和“中国常用平台链接解析”能力。

核心需求：

- 多设备入口：Android、macOS、Windows、Linux 都可以通过 Karakeep 原有客户端、网页端、浏览器扩展或 API 保存内容。
- 普通网页继续使用 Karakeep 原生 crawler、reader、full page archive、yt-dlp 视频下载能力。
- 特殊平台链接不强行使用通用网页 crawler，而是按域名转发到外部 resolver。
- 外部 resolver 负责平台登录态、签名、反爬、正文解析和必要的媒体下载。
- Karakeep 负责最终 bookmark 数据、asset 数据、前端展示、搜索、归档和生命周期管理。
- 离线保存优先级高于节省存储，默认希望开启 `CRAWLER_FULL_PAGE_ARCHIVE=true` 和 `CRAWLER_VIDEO_DOWNLOAD=true`。

当前架构原则：

```text
入口 App / 网页 / API
  -> Karakeep 创建 link bookmark
  -> Karakeep worker 按 URL 域名选择 resolver
  -> resolver 返回结构化正文和本地媒体文件路径
  -> Karakeep 导入媒体到自己的 asset store
  -> Karakeep 生成 reader 内容、封面、视频、metadata、full page archive
```

## 2. 当前已实现功能

### 2.1 普通网页收藏

普通网页仍走 Karakeep 原生逻辑。

已具备：

- 抓取标题、描述、favicon、封面图。
- 生成 reader 视图。
- 保存 HTML content。
- 开启 `CRAWLER_FULL_PAGE_ARCHIVE=true` 后生成完整网页归档。
- 可选截图和 PDF。
- 对 YouTube、Bilibili 等 yt-dlp 支持的网站，可开启视频下载。

已做过的增强：

- `yt-dlp` 下载参数已调整为优先下载 H.264/mp4，避免 Safari / QuickTime 无法播放 webm。
- 视频类站点后续方向是统一只保留“封面 + 视频 + metadata”，不追求保存完整网页 DOM。

### 2.2 从分享文本中提取 URL

Android 上部分 App 复制出来的是“说明文字 + 短链接 + 口令”的混合文本，例如：

```text
3.53 复制打开抖音，看看【老许维修的作品】... https://v.douyin.com/OxkvsdpiLis/ :0pm V@y.Ty
```

当前 Karakeep 创建 link bookmark 时已支持：

- 如果传入值本身是合法 URL，保持原逻辑。
- 如果传入值是混合文本，提取第一个 `http://` 或 `https://` 链接。
- 多个链接时只保存第一个。
- PATCH/update 仍保持严格 URL，不接受混合文本。

相关文件：

- `packages/shared/utils/url.ts`
- `packages/shared/types/bookmarks.ts`
- `packages/trpc/routers/bookmarks.test.ts`

### 2.3 小红书

当前使用外部 `Spider_XHS` HTTP resolver。

Karakeep 支持的域名：

- `xiaohongshu.com`
- `*.xiaohongshu.com`
- `xhslink.com`
- `*.xhslink.com`
- `xhslink.cn`
- `*.xhslink.cn`

已实现：

- 图文笔记解析标题、正文、作者、图片。
- 图文笔记在 reader 视图中按“小红书式横向图片画廊 + 下方正文”展示。
- 图文图片由 `Spider_XHS` 下载到共享 `/downloads`，再由 Karakeep 导入 asset。
- live photo 支持图片和 live 视频文件导入。
- 视频笔记走 `videoWorker` 调用 `/api/xhs/download` 导入封面和视频。
- 图文笔记已经设置 `skipVideoDownload: true`，不再触发误导性的 videoWorker 媒体下载 warning。

相关 Karakeep 文件：

- `apps/workers/workers/linkResolver/providers/spiderXhs.ts`
- `apps/workers/workers/videoDownloader/xiaohongshu.ts`
- `apps/workers/workers/videoWorker.ts`

外部 resolver 仓库：

- `/home/zhangzhicheng/workspace/own/Spider_XHS`

主要配置：

```env
XIAOHONGSHU_BACKEND=spider_xhs
XIAOHONGSHU_SPIDER_ENDPOINT=http://spider-xhs:18061/api/xhs/note
XIAOHONGSHU_SPIDER_DOWNLOAD_ENDPOINT=http://spider-xhs:18061/api/xhs/download
```

Cookie 配置在测试部署中使用文件：

```text
secrets/xhs-cookie.txt
```

### 2.4 酷安

当前使用外部 `eric-coolpak-spider` resolver。

Karakeep 支持的域名：

- `coolapk.com`
- `*.coolapk.com`
- `coolmarket.com.cn`
- `*.coolmarket.com.cn`

已实现：

- 酷安 feed 链接解析。
- 标题、正文、作者、发布时间。
- 图片由 resolver 下载到 `/downloads/coolapk/...`。
- Karakeep 导入图片并替换正文中的图片 URL。
- 修复过正文里被转义的 `<a>` 链接和 tag 链接显示问题。
- full page archive 已统一为居中正文宽度，避免图片过宽导致横向滚动。

相关 Karakeep 文件：

- `apps/workers/workers/linkResolver/providers/coolapk.ts`

外部 resolver 仓库：

- `/home/zhangzhicheng/workspace/own/eric-coolpak-spider`

主要配置：

```env
COOLAPK_RESOLVER_ENDPOINT=http://coolapk-resolver:18062/api/coolapk/feed
```

### 2.5 什么值得买

当前使用外部 `eric-smzdm-spider` resolver。

Karakeep 支持的 URL：

- `https://post.smzdm.com/p/<id>/`
- `https://post.m.smzdm.com/p/<id>/`

已实现：

- 标题、正文、作者、发布时间、封面、正文图片。
- 图片由 resolver 下载到 `/downloads/smzdm/...`。
- Karakeep 导入图片并替换正文图片 URL。
- full page archive 版式已在 Karakeep provider 中统一为居中正文宽度。

相关 Karakeep 文件：

- `apps/workers/workers/linkResolver/providers/smzdm.ts`

外部 resolver 仓库：

- `/home/zhangzhicheng/workspace/own/eric-smzdm-spider`

主要配置：

```env
SMZDM_RESOLVER_ENDPOINT=http://smzdm-resolver:18063/api/smzdm/article
```

### 2.6 微信公众号

当前使用改造后的 `wechat-article-exporter` resolver。

Karakeep 支持的 URL：

- `https://mp.weixin.qq.com/s/...`

已实现：

- 标题、正文、公众号名称、作者、发布时间、封面、正文图片。
- resolver 使用 `WECHAT_ARTICLE_AUTH_KEY` 做接口保护。
- 图片由 resolver 下载到 `/downloads/wechat/...`。
- Karakeep 导入图片并替换正文图片 URL。
- 修复过深色模式下微信正文内联白色背景过重的问题：Karakeep provider 会移除部分强制白底 inline style。

相关 Karakeep 文件：

- `apps/workers/workers/linkResolver/providers/wechatArticle.ts`

外部 resolver 仓库：

- `/home/zhangzhicheng/workspace/own/wechat-article-exporter`

主要配置：

```env
WECHAT_ARTICLE_RESOLVER_ENDPOINT=http://wechat-article-exporter:3000/api/karakeep/v1/wechat/article
WECHAT_ARTICLE_AUTH_KEY=<auth-key>
```

Wechat resolver 自身需要 fs KV 保存登录态。测试部署中挂载：

```text
./data/wechat-article-exporter:/app/.data
```

### 2.7 抖音

当前使用外部 `douyin-downloader` resolver。

Karakeep 支持的域名：

- `douyin.com`
- `*.douyin.com`
- `iesdouyin.com`
- `*.iesdouyin.com`

已实现：

- 支持抖音长链和短链。
- resolver 负责下载封面、视频、metadata。
- Karakeep 导入封面为 `LINK_BANNER_IMAGE`。
- Karakeep 导入视频为 `LINK_VIDEO`。
- Karakeep 导入 metadata JSON 为普通附件。
- full page archive 是 Karakeep 根据 resolver 结果生成的离线展示页，不是抖音原页面 DOM。

相关 Karakeep 文件：

- `apps/workers/workers/linkResolver/providers/douyin.ts`
- `apps/workers/workers/videoDownloader/douyin.ts`

外部 resolver 仓库：

- `/home/zhangzhicheng/workspace/own/douyin-downloader`

主要配置：

```env
DOUYIN_RESOLVER_ENDPOINT=http://douyin-resolver:18064/api/karakeep/v1/douyin
DOUYIN_COOKIE=<cookie>
```

注意：`douyin-downloader` 会维护 `/downloads/download_manifest.jsonl`，用于从下载结果中找回文件和处理重复下载。

## 3. Karakeep 代码结构

当前改造主要集中在 worker 和共享类型层。

### 3.1 域名路由

文件：

```text
apps/workers/workers/linkResolver/registry.ts
```

职责：

- 根据 URL 域名选择 resolver。
- 未配置 resolver 时返回 fail-fast provider。
- 特殊平台失败时不回退普通 crawler，避免保存验证码页、登录页或空壳页。

当前注册的 provider：

- `SpiderXhsProvider`
- `XiaohongshuMcpProvider`
- `CoolapkProvider`
- `SmzdmProvider`
- `WechatArticleProvider`
- `DouyinProvider`

### 3.2 resolver 通用协议

文件：

```text
apps/workers/workers/linkResolver/types.ts
```

核心结构：

```ts
interface ResolvedLinkContent {
  title?: string | null;
  description?: string | null;
  author?: string | null;
  publisher?: string | null;
  datePublished?: Date | null;
  dateModified?: Date | null;
  imageUrl?: string | null;
  favicon?: string | null;
  htmlContent?: string | null;
  finalUrl?: string | null;
  archivableAssets?: ResolvedLinkAsset[];
  skipVideoDownload?: boolean;
}
```

`archivableAssets` 是第三方 resolver 和 Karakeep 之间的关键交接字段。它可以指向远程 URL，也可以指向 resolver 已经下载好的本地 `path`。

### 3.3 resolver 结果持久化

文件：

```text
apps/workers/workers/linkResolver/persist.ts
```

职责：

- 导入 `archivableAssets`。
- 把本地文件或远程图片保存为 Karakeep asset。
- 替换正文中的原始媒体 URL 为 `/api/assets/<assetId>`。
- 保存 reader htmlContent。
- 生成 full page archive。
- 更新 bookmarkLinks 表中的标题、描述、封面、视频、归档 asset id。

当前本地文件导入流程：

```text
resolver /downloads/... 文件
  -> Karakeep copy 到 /tmp/<assetId>
  -> saveAssetFromFile copy 到 DATA_DIR/assets/<userId>/<assetId>/asset.bin
  -> 删除 /tmp 文件
  -> 删除 resolver /downloads/... 源文件
```

因此成功导入的文件理论上不会长期保存两份，但空目录、manifest、失败残留文件仍可能存在。

### 3.4 视频下载

文件：

```text
apps/workers/workers/videoWorker.ts
```

职责：

- 如果 `CRAWLER_VIDEO_DOWNLOAD=false`，跳过视频下载。
- 小红书视频调用 `XIAOHONGSHU_SPIDER_DOWNLOAD_ENDPOINT`。
- 抖音视频当前主要由 link resolver 直接完成下载和导入。
- 普通视频站点调用 `yt-dlp`。

相关配置：

```env
CRAWLER_VIDEO_DOWNLOAD=true
CRAWLER_VIDEO_DOWNLOAD_MAX_SIZE=-1
CRAWLER_YTDLP_ARGS=-f%%bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc1]/best[ext=mp4]/best%%--merge-output-format%%mp4
```

### 3.5 分享文本 URL 提取

文件：

```text
packages/shared/utils/url.ts
packages/shared/types/bookmarks.ts
```

职责：

- 创建 link bookmark 时接受混合文本。
- 提取第一个合法 HTTP(S) URL。
- 保持更新接口严格，避免已有 URL 被意外改写。

## 4. 当前测试部署结构

测试部署目录：

```text
/home/zhangzhicheng/workspace/own/eric-fragment-collector-test
```

主要文件：

```text
docker-compose.yml
.env
secrets/xhs-cookie.txt
config/douyin/config.yml
data/
```

当前 compose 中的核心服务：

- `karakeep`
- `chrome`
- `meilisearch`
- `spider-xhs`
- `coolapk-resolver`
- `smzdm-resolver`
- `wechat-article-exporter`
- `douyin-resolver`

当前镜像策略：

- Karakeep 测试镜像：`ghcr.io/blueloverest/karakeep-aio:<eric-tag>`
- Coolapk / SMZDM 可以使用内网 Gitea registry 镜像。
- XHS / WeChat / Douyin 当前可使用 GHCR 或后续迁移到 Gitea registry。

推荐后续整理为一个独立的部署编排仓库，不建议把 resolver 作为 submodule 放进 Karakeep 主仓库。原因是 Karakeep 需要长期合并原版上游，主仓库越干净越好。

## 5. 当前存储模型

### 5.1 Karakeep

测试部署中：

```text
data/karakeep/db.db
data/karakeep/queue.db
data/karakeep/assets/<userId>/<assetId>/asset.bin
data/karakeep/assets/<userId>/<assetId>/metadata.json
```

说明：

- `db.db` 是 Karakeep SQLite 主数据库。
- `queue.db` 是任务队列数据库。
- asset 真正文件不在数据库里，而是在 `assets/` 目录里。
- 数据库只保存 asset id、类型、大小、文件名、bookmark 关联等元数据。

当前测试数据规模：

```text
data/karakeep/assets: 约 223 MiB
data/resolver-downloads: 约 7.2 MiB
data/meilisearch: 约 4.6 MiB
```

### 5.2 resolver

Coolapk：

- 无数据库。
- 文件写到 `/downloads/coolapk/...`。

SMZDM：

- 无数据库。
- 文件写到 `/downloads/smzdm/...`。

Spider_XHS：

- 无数据库。
- 需要 cookie 文件。
- 文件写到 `/downloads/...`。

Wechat article exporter：

- 有 fs KV，用于保存登录态，路径 `/app/.data/kv/...`。
- 文件写到 `/downloads/wechat/...`。
- 原项目还有 Dexie/IndexedDB 相关前端缓存模型，但当前 Karakeep resolver 接口主要依赖服务端改造接口。

Douyin downloader：

- server 场景没有启用原项目 SQLite 下载数据库。
- 使用 `/downloads/download_manifest.jsonl` 记录下载 manifest。
- 文件写到 `/downloads/...`。

### 5.3 重复存储现状

当前设计中，resolver 的 `/downloads` 是 staging 区，不应该作为长期素材库。

成功流程：

- resolver 下载文件到 `/downloads`。
- Karakeep 读取该 path。
- Karakeep 导入到自己的 asset store。
- Karakeep 删除 resolver 源文件。

仍存在的问题：

- 失败或中断时 staging 可能残留文件。
- 空目录不会自动清理。
- Douyin manifest 会长期保留。
- 如果 resolver 下载了 Karakeep 没有导入的额外文件，可能残留。

后续建议：

- 增加 staging 清理任务。
- 只删除超过一定时间且不在进行中的 staging 文件，例如 24 小时。
- 保留 resolver manifest，但不保留已导入大文件。
- 对每个平台测试“成功导入后 staging 是否只剩空目录或 manifest”。

## 6. 当前资源占用

在测试机器当前空闲/轻负载下，`docker stats --no-stream` 结果约为：

```text
eric-karakeep                  490.8 MiB
eric-karakeep-meilisearch       63.9 MiB
eric-douyin-resolver            52.8 MiB
eric-spider-xhs                 69.7 MiB
eric-wechat-article-exporter    21.6 MiB
eric-smzdm-resolver             23.4 MiB
eric-coolapk-resolver           18.2 MiB
eric-karakeep-chrome            33.6 MiB
```

Karakeep 相关服务合计约 774 MiB。

注意：

- Karakeep AIO 是主要内存占用来源。
- resolver 常驻内存都不高。
- Chrome、yt-dlp、图片处理、视频下载会在抓取时短时增加 CPU/RAM。
- `CRAWLER_PARSER_MEM_LIMIT_MB` 默认 512 MiB，复杂网页解析可能触发较高峰值。

## 7. 已知问题和风险

### 7.1 跟随上游 Karakeep 的长期维护

当前改造是在 Karakeep fork 上进行，后续需要持续合并原版上游。

风险：

- link resolver、crawler、asset store、worker queue 是 Karakeep 内部核心逻辑，未来上游变动可能导致冲突。
- 不建议把 resolver 源码放进 Karakeep 主仓库。

建议：

- Karakeep 保持一个长期自定义分支，例如 `eric/custom`。
- 用 merge 而不是 rebase 合并上游，冲突可追踪。
- 每次合并上游后优先跑 resolver 相关测试。

### 7.2 resolver 失效风险

小红书、抖音、微信公众号、SMZDM 都存在平台风控变化风险。

要求：

- resolver 失败必须 fail-fast。
- 不要回退通用 crawler 保存验证码页。
- 错误信息要能区分 cookie 失效、限流、解析失败、下载失败。
- Cookie 失效需要有明确更新路径。

### 7.3 staging 清理

当前不是严重问题，但需要补齐长期清理机制。

建议实现：

- Karakeep 成功导入后递归清理空目录。
- 增加定时任务清理超过 TTL 的 staging 文件。
- resolver 返回结果中可以带 `cleanupPaths`，由 Karakeep 导入完成后统一清理。

### 7.4 HTML URL 替换不完整

当前 URL 替换能覆盖大部分 `src`、`href`、markdown 图片场景，但仍可能漏掉：

- `srcset`
- lazy-load 字段
- CSS background image
- 被复杂转义的 URL
- 脚本动态加载资源

后续如果某个平台出现图片未离线，应优先检查 `replaceArchivedAssetUrls` 和该平台 provider 生成的 HTML。

### 7.5 视频格式与播放兼容性

已经处理过 webm 在 Safari / QuickTime 中兼容性差的问题。

当前策略：

- yt-dlp 优先 H.264/mp4。
- 不限制视频文件大小。
- 视频站点目标是“封面 + 视频 + metadata”。

仍需关注：

- 某些站点最高画质可能只有 webm/av1。
- 强制 mp4 可能牺牲最高画质。
- 如果需要“最高画质”和“Apple 兼容”同时满足，可能需要后续引入转码，但这会显著增加 CPU 消耗。

### 7.6 本地构建成本

Karakeep 镜像构建很重，原因包括：

- monorepo workspace 多。
- Next.js web。
- workers。
- native npm 包，例如 `better-sqlite3`、`sharp`、`re2`。
- monolith Rust 构建。
- ffmpeg、ghostscript、graphicsmagick、yt-dlp 等运行时依赖。

当前更适合：

- 日常使用远端 CI 构建 amd64 AIO 镜像。
- 本地只在 GitHub/Gitea 镜像不可用时构建。
- 后续迁到 Gitea Actions 后，只构建 linux/amd64 AIO，可降低构建复杂度。

## 8. 推荐仓库组织

不建议使用 git submodule 把 resolver 放进 Karakeep。

推荐本地工作区：

```text
/home/zhangzhicheng/workspace/own/fragment-collector-workspace/
  karakeep/
  Spider_XHS/
  eric-coolpak-spider/
  eric-smzdm-spider/
  wechat-article-exporter/
  douyin-downloader/
  eric-fragment-collector-test/
```

每个目录仍然是独立 git 仓库。

推荐远端策略：

- Gitea 作为自用主仓库和镜像 registry。
- 每个仓库保留 `upstream` remote 指向原始开源项目。
- 如果仍需要 GitHub Actions/GHCR，可保留 GitHub fork 作为过渡或镜像源。

Karakeep remote 推荐：

```text
origin   Gitea 自用主仓库
github   GitHub fork，可选
upstream 原版 karakeep-app/karakeep
```

同步到 Gitea 时必须推送所有自定义分支和 tag：

```bash
git push origin --all
git push origin --tags
```

## 9. 测试建议

Karakeep 单元测试：

```bash
pnpm --filter @karakeep/workers test -- workers/linkResolver/providers/spiderXhs.test.ts
pnpm --filter @karakeep/workers test -- workers/linkResolver/providers/coolapk.test.ts
pnpm --filter @karakeep/workers test -- workers/linkResolver/providers/smzdm.test.ts
pnpm --filter @karakeep/workers test -- workers/linkResolver/providers/wechatArticle.test.ts
pnpm --filter @karakeep/workers test -- workers/linkResolver/providers/douyin.test.ts
```

共享包检查：

```bash
pnpm --filter @karakeep/shared typecheck
pnpm --filter @karakeep/workers typecheck
pnpm --filter @karakeep/workers lint
pnpm --filter @karakeep/workers format
```

端到端手动测试重点：

- 普通网页：reader、图片、full page archive。
- Bilibili：封面和视频是否生成，视频能否在 Safari/Chrome 播放。
- YouTube：是否保存 mp4/H.264。
- 小红书图文：横向图片画廊是否显示，staging 是否无大文件残留。
- 小红书视频：封面、视频、live photo 是否导入。
- 抖音：短链、封面、视频、metadata 是否导入。
- 酷安：正文链接、tag 链接、图片替换、full page archive 版式。
- SMZDM：图片宽度、正文链接、full page archive 版式。
- 微信公众号：深色模式白底、图片替换、登录态。

## 10. 下一步优先级

建议按以下顺序继续：

1. 提交当前小红书图文 `skipVideoDownload` 修复，并打新 tag 构建镜像。
2. 新建本地 workspace 或部署编排仓库，统一管理所有仓库和 compose。
3. 把 resolver 仓库和镜像逐步迁到 Gitea，CI 只构建 linux/amd64。
4. 实现 staging 清理策略，解决残留文件和空目录问题。
5. 为每个平台补一组“resolver 返回 path -> Karakeep 导入 -> staging 删除”的回归测试。
6. 为视频站点沉淀统一语义：只保留封面、视频、metadata。
7. 后续研究 Bilibili 弹幕离线保存，可能作为 metadata 或独立附件导入。

## 11. 当前未提交改动

截至本文档编写时，Karakeep 工作区有一处未提交修复：

```text
apps/workers/workers/linkResolver/providers/spiderXhs.ts
apps/workers/workers/linkResolver/providers/spiderXhs.test.ts
```

内容：

- 小红书图文笔记 provider 返回 `skipVideoDownload: true`。
- 防止图文笔记进入 videoWorker 后出现 `Spider_XHS download completed without downloadable media files` 的误导 warning。

已验证：

```bash
pnpm --filter @karakeep/workers test -- workers/linkResolver/providers/spiderXhs.test.ts
pnpm --filter @karakeep/workers lint
pnpm --filter @karakeep/workers format
pnpm --filter @karakeep/workers typecheck
```
