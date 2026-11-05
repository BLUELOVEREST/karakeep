# 抓取异常与 Android FCM 通知

## 范围与行为

普通网页与独立 resolver 共用抓取事件，Web 设置和 APK 设置中的 **Capture events** 展示最近 50 条历史。收藏详情展示当前抓取状态、错误说明、处理建议和重新抓取入口。

- `running` / `retrying`：抓取或自动重试中，不发送失败通知。
- `awaiting_media`：正文处理完成，仍等待自动视频下载，不提前宣布恢复。
- `capture.failed`：明确终止或自动重试耗尽。
- `capture.partial`：正文保存成功，但阅读图片或关联视频未完整归档。
- `capture.recovered`：之前的失败或部分完成在本次抓取及关联视频处理后恢复。
- `push.test`：用户主动发送的测试通知。

三分钟以上只显示“耗时较长”，不据此判定失败。旧异常不会在升级时批量补发；重新抓取后才产生新的生命周期事件。CookieCloud 的同步状态继续在 Resolver Settings 展示，本版事件范围是收藏抓取，不包含周期性的配置健康检查。更新 Cookie 后仍需主动重新抓取。

事件按用户隔离并持久保存。通知采用独立数据库 outbox，每五秒扫描。认证失败按用户、设备、平台及两分钟窗口合并，其他结果通常延迟五秒发送。已有更新结果的旧事件不再推送。FCM 临时失败最多尝试五次，以 30 秒起步指数退避；配置或请求错误直接记录失败；明确无效的 token 被停用。

投递是“至少一次尝试”，不是严格恰好一次：进程在发送成功、确认写库前崩溃时可能重复。Android 使用稳定通知 tag 减少重复显示。FCM 接受不代表手机已经展示。超过 24 小时的待发送通知不再投递，设备 30 天未续约则跳过。长时间离线时 FCM 可能合并通知，事件历史是最终依据。

每次扫描最多处理 500 条投递记录；极大批量认证失败可能跨批次形成多条合并通知。任务进程被强制终止而队列未执行终态回调时，界面可能保持处理中；本版不以时间推测失败，也不增加任务看门狗。

## Firebase 项目

无需使用 Expo 的推送中转服务，不需要 EAS 云构建。FCM 本身免费，推送服务端运行在现有 Karakeep workers 中。

1. 在 Firebase 控制台创建项目并添加 Android 应用。正式 APK 包名是 `app.hoarder.hoardermobile`，开发 APK 是 `app.hoarder.hoardermobile.dev`。需要测试两个版本时，在同一项目分别注册这两个 Android 应用。
2. 下载 Android 客户端 `google-services.json`。它应包含对应的包名；不要把服务账号 JSON 当作这个文件。
3. 在项目的服务账号页面生成服务端私钥 JSON，并确认 Firebase Cloud Messaging HTTP v1 API 已启用，服务账号具有发送消息的权限。
4. 客户端配置与服务账号必须属于同一 Firebase 项目。限制 Android API key 时同时配置正确的包名和签名证书，否则 token 注册可能失败。

## 服务端部署

只在需要发送推送的 workers/AIO 容器挂载服务账号文件即可；如果 Web 与 workers 分开部署，Web 也需配置 `FCM_SERVICE_ACCOUNT_FILE` 才会开放设备注册与测试接口。生产部署建议两者读取同一个只读挂载文件。

```yaml
environment:
  FCM_SERVICE_ACCOUNT_FILE: /run/secrets/firebase-service-account.json
volumes:
  - ./secrets/firebase-service-account.json:/run/secrets/firebase-service-account.json:ro
```

修改环境或服务账号后重新创建容器。必须启用 `adminMaintenance` worker，FCM 后台投递与 CookieCloud 调度均由它所在的 workers 进程启动。没有该环境变量时只关闭推送；抓取、事件记录和查询仍正常工作。错误 JSON 或无效凭据不会阻止抓取，但测试投递会显示 `FCM_CONFIGURATION_ERROR` 或对应的脱敏错误码。

服务账号私钥不要提交仓库、放进 APK、发送给聊天机器人，或通过 API 返回。限制文件权限，保护数据库与备份中的设备 token。事件和推送只包含稳定错误说明、平台及对象 ID，不包含原始网页正文、Cookie、带签名资源链接或服务端异常堆栈。

## APK 构建与开启

GitHub 仓库添加 Secret：`FIREBASE_GOOGLE_SERVICES_BASE64`，内容为 Android 客户端 JSON 的 base64。现有 Android workflow 会在 runner 临时目录恢复配置，再执行 Expo prebuild。没有 Secret 时会明确警告并构建 **FCM 禁用** 的兼容 APK。

本地构建可以设置：

```sh
export GOOGLE_SERVICES_JSON=/private/path/google-services.json
```

Expo 配置会检查 Android 包名，并拒绝把服务账号私钥误打包。既有 APK 不会自动获得 FCM，必须重新安装包含原生 notifications 模块的新构建。

在 APK 设置的 **Notifications** 页面开启 **Capture notifications**，允许 Android 通知权限，再使用 **Send test notification**。页面可查看测试任务的 `pending`、`sent`、`failed` 等投递状态。未提供 APK Firebase 配置或服务端配置时不能开启。

前台、后台与冷启动点击通知均通过当前登录 scope 校验后打开收藏；合并提醒打开事件历史。不得通过通知中的任意 URL 导航。退出账号或切换服务会尽力注销服务端登记、撤销本机原生 token 并清理已展示通知；API key 被撤销时其设备记录级联删除。离线注销不能承诺撤回已经进入系统通知队列的消息；需要立即禁止全部系统展示时可关闭 Android 的应用通知权限。Android 强制停止应用和系统省电策略也可能阻止及时展示。

## 外部接口

使用当前 API key 的 Bearer 认证；事件读取要求 `bookmarks:read`，设备管理要求 `users:readwrite`，查询设备要求 `users:read`。普通手机登录使用的完整权限 key 无需改变。

- `GET /api/v1/capture/events?cursor=0&limit=50`：升序事件流，返回 `items`、`nextCursor`、`hasMore`。保存游标可增量读取，不修改已读状态。
- `GET /api/v1/capture/bookmarks/:id`：当前抓取状态；其他用户的对象返回空结果。
- `GET /api/v1/capture/push`：FCM 配置能力与自己的设备元信息，不返回 token。
- `POST /api/v1/capture/devices`：请求体 `{ "token": "native-fcm-token", "scope": "current-login-id" }`。
- `DELETE /api/v1/capture/devices/:scope`：注销当前用户对应的设备。
- `POST /api/v1/capture/push/test`：请求体 `{ "scope": "current-login-id" }`，返回 `eventId`；每分钟最多一次。
- `GET /api/v1/capture/events/:id/deliveries`：查询自己事件的投递状态与脱敏错误码。

tRPC 对应 `capture.events/status/recent/pushStatus/registerDevice/unregisterDevice/testPush/deliveries`。外部系统以后可通过事件流轮询接入 Telegram、Bark。服务端保留 `NotificationTransport` 接口；本版仅实现 FCM，不创建 Telegram/Bark 连接，也不配置额外外发 webhook。

## 验收

使用普通网页和至少一个 resolver 分别验证最终失败、自动重试中不提醒、部分媒体失败及恢复；批量认证失败验证合并。模拟 FCM 暂时失败、永久错误、撤销 token、过期 lease、其他用户访问和退出登录后的旧通知点击。真实手机通知必须在项目配置完成、APK 重建后验证，模拟 SDK 测试不能替代这一步。

参考：[Firebase 服务端接入](https://firebase.google.com/docs/cloud-messaging/server-environment)、[Expo 原生 FCM](https://docs.expo.dev/push-notifications/sending-notifications-custom/)。
