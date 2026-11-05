# CookieCloud Cookie Synchronization

Administrators can configure CookieCloud under **Settings > Resolver Settings**. This integration synchronizes Xiaohongshu and Douyin cookies into their existing runtime configuration APIs. No resolver changes or APK update are required. WeChat's fixed service key is not a website cookie and is never synchronized.

## Configuration

1. Configure the browser CookieCloud extension to upload cookies for `xiaohongshu.com` and `douyin.com` to your existing CookieCloud server.
2. Enter the server base URL (including an API path prefix if applicable), UUID, and decryption password in Karakeep. Do not append `/get/:uuid` yourself.
3. Select hourly, every six hours, every twelve hours, daily, or a custom five-field cron expression. The default is every six hours, in `Asia/Shanghai`. The timezone accepts IANA names such as `UTC` and `Asia/Shanghai`. Daily means midnight in that timezone, not 24 hours after saving. Seconds fields and `@daily` shortcuts are not accepted.
4. Save, then select **Sync now** to verify access. Manual sync works even when automatic synchronization is disabled.

The backend workers refresh schedule configuration within approximately ten seconds. They must be running with `adminMaintenance` enabled. Closing the browser does not stop synchronization. Missed runs while workers are stopped are not replayed; use Sync now after downtime if necessary.

## Update Rules

- Manual cookie saves and successful automatic synchronization both overwrite the current value and dispatch it immediately. The next cloud synchronization can overwrite a manual edit even when cloud contents have not changed.
- A failed download, wrong password, missing domain, expired-only cookies, or empty platform data does not clear existing cookies.
- Each platform is processed independently; a resolver failure does not prevent the other platform from updating. Status reports the latest attempt and each platform's outcome. `missing` means no applicable cookies, `unavailable` means no resolver endpoint is configured, and `failed` means download/decryption or platform dispatch failed.
- Cookie source and modification time are shown in the existing platform fields. Successful synchronization means the cookie was delivered, not that the website has accepted the login session.
- Existing environment values remain fallbacks when runtime overrides are cleared. Clearing an override does not disable CookieCloud; a later sync can write it again.

## Security and Compatibility

Karakeep downloads encrypted data and decrypts it locally, without sending the password to CookieCloud. Both encryption modes offered by the current official implementation (`aes-128-cbc-fixed` and `legacy`) are supported. Unsupported future formats fail closed. Only root-path cookies applicable to the configured platforms' website domains are selected; unrelated domains, expired cookies and unsafe header values are ignored. LocalStorage is not imported.

The password is never returned by the settings API or printed in synchronization logs. Like existing resolver runtime secrets, it is stored in the application database, so protect database files and backups. Use HTTPS outside a trusted network, and restrict access to both CookieCloud and resolver configuration APIs. An administrator-configured private-network CookieCloud address is intentionally supported. Redirects are not followed; configure the final service URL.

CookieCloud does not renew expired website sessions. Log in again in your browser when needed. IP-based verification and website anti-bot checks can still prevent crawling.

Protocol reference: [official CookieCloud server implementation](https://github.com/easychen/CookieCloud/blob/wxt/api/app.js).
