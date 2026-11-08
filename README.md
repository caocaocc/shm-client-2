# SHM Client 简体中文版

面向 SHM（Service Hosting Manager）的用户中心，提供套餐购买、续费、连接配置与账户管理。本分支默认使用简体中文和 `Asia/Shanghai` 时区，保留多语言切换和用户已保存的语言。

主要功能：

- 账户登录：密码、双重验证、Passkey、Telegram Widget、Mini App 与 OIDC。
- 服务管理：购买、更换套餐、暂停和删除服务。
- 连接配置：显示 Remnawave／Marzban 订阅链接与二维码，下载 WireGuard／Amnezia 配置，通过 URL Scheme 导入客户端。
- 订阅用量：显示可得的状态、流量、重置周期、到期时间和设备上限。
- 账务管理：充值、付款记录、扣费记录、续费预估和自动付款管理。
- 账户设置：修改资料、绑定邮箱或 Telegram、管理账户安全。
- 界面语言：简体中文、英语、俄语、德语、西班牙语、法语、乌兹别克语和阿拉伯语，也可加载自定义语言。

[上游俄文说明](docs/README.upstream.ru.md) 保留供查阅；本页描述当前分支的接入方式。

## 本地开发与验证

本节仅用于开发和验证客户端源码，不是安装 Remnawave 模板的前提。已有站点的客户端更新沿用当前部署与发布流程。

安装依赖后启动开发服务：

```sh
npm ci
npm run dev
```

生产构建输出到 `dist/`：

```sh
npm run build
```

离线回归检查使用 Node.js 22.18+：

```sh
node --test src/utils/*.test.ts src/api/*.test.ts src/hooks/*.test.ts
```

## Docker Compose

以下保留上游 Docker Compose 镜像方式的示例，`SHM_URL` 填写实际 SHM API 根地址。已有站点沿用自己的 Compose 配置、镜像标签与发布流程，无需为安装 Remnawave 模板重新部署客户端：

```yaml
services:
  client:
    image: danuk/shm-client-2:latest
    ports:
      - "3001:80"
    environment:
      SHM_URL: "https://api.example.com"
      APP_NAME: "用户中心"
      APP_DESCRIPTION: "套餐与连接管理"
      DEFAULT_LANGUAGE: "zh-CN"
    restart: unless-stopped
```

```sh
docker compose up -d
```

沿用官方容器入口生成运行配置；本分支没有修改入口脚本。开发构建使用已有的 `VITE_` 配置，例如 `VITE_DEFAULT_LANGUAGE`、`VITE_TIMEZONE`、`VITE_PROXY_STORAGE_PREFIX`。应用默认时区为上海，无需新增环境变量；如需其他显示时区，使用构建时的 `VITE_TIMEZONE` 或现有 `config.js` 的 `TIMEZONE` 字段。

### 基础配置

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SHM_URL` | SHM API 根地址 | 未设置 |
| `SHM_HOST` | `SHM_URL` 的备用变量 | 未设置 |
| `SHM_BASE_PATH` | 客户端基础路径，例如 `/cabinet` | `/` |
| `APP_NAME` | 应用名称 | `SHM Client` |
| `APP_DESCRIPTION` | 应用说明 | 未设置 |
| `LOGO_URL` | 网站图标地址 | 本地 `favicon.jpg` |
| `DEFAULT_LANGUAGE` | 默认语言 | `zh-CN` |
| `SINGLE_LANGUAGE` | 设为 `true` 时只使用默认语言 | 未设置 |
| `CUSTOM_LANGS` | 自定义语言代码，多个值用逗号分隔 | 未设置 |

金额沿用 SHM 账本返回的币种，不根据界面语言转换数值或改换币种标识。人民币显示为前置 `¥`，保留当前语言的数字格式；付款请求始终使用两位小数的 ASCII 金额。当前官方镜像入口未显式设置语言时仍会输出俄语默认值；应用首次使用简体中文，之后尊重用户保存的语言，无需替换官方入口脚本。

## Remnawave 3.4.7 接入

模板沿用上游安装方法：在 SHM 后台打开 **Templates → Add new**，自选模板名（例如 `vpn_rmw`），粘贴配套单文件模板的完整内容，再点击 **Save** 保存。安装模板本身不需要重新部署客户端。

客户端通过当前用户的 SHM 会话读取 Storage；Remnawave 管理员 Token 留在服务端模板配置中。沿用现有 SHM 套餐的服务类别，不需要为接入模板改名。若类别不能自动识别，可将其现有值填入 `PROXY_CATEGORY`，多个值用逗号分隔；新站点可选用 `remnawave` 作为类别示例。

配套 Remnawave 生命周期模板写入 `vpn_remna_{user_service_id}`。客户端只读取 `PROXY_STORAGE_PREFIX` 指定的一个 Storage key，默认前缀为 `vpn_remna_`；不遍历其他前缀，也不为旧数据额外发起请求。自定义前缀时，写入方应使用相同 key。

模板存储 Remnawave 订阅信息接口的 `response` 本体，并补充规范化 `subscription_url`：

```json
{
  "isFound": true,
  "subscription_url": "https://sub.example.com/your-subscription",
  "subscriptionUrl": "https://sub.example.com/your-subscription",
  "user": {
    "userStatus": "ACTIVE",
    "trafficUsedBytes": "1073741824",
    "trafficLimitBytes": "322122547200",
    "trafficLimitStrategy": "MONTH",
    "expiresAt": "2026-11-01T00:00:00Z"
  }
}
```

读取当前模板的 `subscription_url` 和 `user` 字段，并处理 SHM 当前 JSON 响应中的单条 `data` 包装。若明确返回 `isFound: false`，该快照中的残留链接和用户数据不会被使用。不会解析旧的 `response` 套层、字符串 JSON 或其他字段别名。

3.4.7 的字节数字符串按 bytes 解析，界面使用二进制单位（GiB）。`MONTH` 是自然月策略；`MONTH_ROLLING` 显示为“滚动月（按创建日）”，按用户创建日锚点滚动计算月份，各月天数可能不同，不能理解为固定每 30 天。界面只读取订阅快照的当前字段，不混用管理员用户接口的其他数据结构。

信息页按实际可得字段显示订阅状态、流量、重置周期与到期时间。订阅接口没有设备限制字段，因此默认不显示设备上限；若存储内容提供 `user.hwidDeviceLimit`，`null` 表示面板默认、`0` 表示不限制、正整数表示设备上限。

所有用量都是最近一次模板同步的快照。刷新按钮重新读取 SHM Storage，不会直接请求面板；未就绪或读取失败时显示提示，稍后可重试。

### 订阅与客户端配置

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PROXY_CATEGORY` | 显示订阅配置的现有 SHM 类别，多个值用逗号分隔；新站点可选 `remnawave` | 自动识别 |
| `PROXY_CATEGORY_TITLE` | 服务分组标题 | 随界面语言显示 |
| `PROXY_STORAGE_PREFIX` | 唯一 Storage 读取前缀，需与写入方一致 | `vpn_remna_` |
| `SHOW_PROXY_SUB_LINK` | 显示订阅链接 | `true` |
| `SHOW_PROXY_QR` | 显示订阅二维码 | `true` |
| `SHOW_HAPP_CRYPTOLINK` | 导入 Happ 时使用加密链接 | `false` |
| `WINDOWS_PROXY_URL_SCHEMA` | Windows 导入订阅的 URL Scheme，例如 `happ://add/` | 未设置 |
| `LINUX_PROXY_URL_SCHEMA` | Linux 导入订阅的 URL Scheme | 未设置 |
| `MAC_PROXY_URL_SCHEMA` | macOS 导入订阅的 URL Scheme | 未设置 |
| `IOS_PROXY_URL_SCHEMA` | iOS 导入订阅的 URL Scheme | 未设置 |
| `ANDROID_PROXY_URL_SCHEMA` | Android 导入订阅的 URL Scheme | 未设置 |

下载地址使用 `PROXY_APP_WINDOWS_URL`、`PROXY_APP_LINUX_URL`、`PROXY_APP_MAC_URL`、`PROXY_APP_IOS_URL`、`PROXY_APP_ANDROID_URL`。对应按钮名称使用 `PROXY_WINDOWS_APP_NAME`、`PROXY_LINUX_APP_NAME`、`PROXY_MAC_APP_NAME`、`PROXY_IOS_APP_NAME`、`PROXY_ANDROID_APP_NAME`；电视端按钮名称使用 `APPLE_TV_APP_NAME`、`ANDROID_TV_APP_NAME`。未指定按钮名称时使用当前语言的下载文案。

### WireGuard／Amnezia 配置

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `VPN_CATEGORY` | 显示配置下载和二维码的类别，例如 `vpn-wg,vpn-awg` | 自动识别 |
| `VPN_CATEGORY_TITLE` | VPN 分组标题 | 随界面语言显示 |
| `VPN_STORAGE_PREFIX` | 配置文件的 Storage 前缀，例如 `wg_key_` | `vpn` |

配置文件的默认 key 为 `vpn{user_service_id}`，例如 `vpn123`。下载地址使用 `VPN_APP_WINDOWS_URL`、`VPN_APP_LINUX_URL`、`VPN_APP_MAC_URL`、`VPN_APP_IOS_URL`、`VPN_APP_ANDROID_URL`；按钮名称使用对应的 `VPN_WINDOWS_APP_NAME`、`VPN_LINUX_APP_NAME`、`VPN_MAC_APP_NAME`、`VPN_IOS_APP_NAME`、`VPN_ANDROID_APP_NAME`。

### 服务类别的自动识别

手动配置的 `PROXY_CATEGORY`、`VPN_CATEGORY` 优先。未配置时：

- 包含 `remna`、`remnawave`、`marzban`、`marz` 或 `mz` 的类别归入订阅服务。
- 以 `vpn`、`wg` 或 `awg` 开头的类别归入 VPN 配置服务；已匹配订阅的类别仍按订阅处理。
- `web_tariff`、`web`、`mysql`、`mail`、`hosting` 分别显示为主机套餐、网站托管、数据库、邮箱、主机服务。
- 其他类别归入“其他”。

## 分流配置

打开服务详情即读取当前服务的分流选项。支持分流且存在已保存出口时预读出口，读取完成前统一显示加载状态；切换页签复用当前详情的数据，关闭详情取消未完成读取。不同服务分别保留表单生命周期，不共享出口凭据。

出口仅从加密保存的原始文本按原格式回填；文本缺失、损坏或与已校验结构不符时显示读取失败，不从 JSON 反向生成出口。规则每行一条。未命中的流量沿用平台现有路由。按钮按动作区分保存、启用和停用；停用不要求先修正未完成的草稿，也不会清空出口原文。任务排队时仅轮询脱敏状态，保留正在编辑的出口和规则，并在有限次数后暂停。

WireGuard 配置中 `[Interface]` 的 `DNS` 会保存为 `settings.remoteDNS`；原生 WireGuard JSON 也支持该字段。DNS 接受 1–8 个纯 IPv4/IPv6 地址，包括服务商的隧道内私网地址，规范化后保留原顺序和重复项；不接受域名、URL、CIDR、端口、zone 或搜索域。未填写时不注入 DNS，由 Xray 使用默认行为。SOCKS5h 与 `--socks5-hostname` 仅导入代理信息，平台仍可能先解析域名，不会因此改写平台 DNS。

如果已有 WireGuard 原文含 `DNS`，但此前保存的结构未含 `remoteDNS`，原文与结构的一致性检查会拒绝界面回填。原有密文、原文和密钥保留，不会根据原文自动补写或静默采用 DNS。要采用这份 DNS，请重新粘贴服务商的完整配置并主动保存。

连接配置读取和分流保存请求均有10秒局部超时。读取失败可显式刷新；分流保存未收到响应时，服务器可能已经保存，因此保留草稿、解除等待、提示结果未确认，并只重新读取一次脱敏状态。不会自动重发保存，也不会把这次草稿标为已保存。请核对状态后再操作。

分流读写通过当前用户的 SHM 会话调用服务选项接口。完整出口仅用于当前详情中的表单，不写入浏览器持久存储，不用于状态轮询；远端异常只显示固定错误码及其翻译。

服务选项接口沿用 SHM 的 `data` 单条数组包装；数组中的 `status` 为状态字符串，失败时同级 `error` 为固定错误码。`data.outbound` 只包含协议、服务器和端口的脱敏摘要；完整配置及原文仍通过当前用户的机密接口读取、通过 `secret.outbound` 与 `secret.outbound_text` 保存。无法识别的响应显示读取失败，保存响应无法确认时保留草稿并重读状态。

## 服务与购买配置

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `VISIBLE_CATEGORIES` | 购买页面显示的类别，多个值用逗号分隔 | 未设置 |
| `BLOCK_ORDER_IF_UNPAID` | 有未付款服务时禁止继续购买 | `false` |
| `ALLOW_SERVICE_BLOCKED` | 允许用户暂停服务 | `true` |
| `ALLOW_SERVICE_DELETE` | 允许用户删除服务 | `true` |
| `ALLOW_SERVICE_CHANGE` | 允许更换套餐 | `true` |
| `ALLOW_SERVICE_CHANGE_FORCE` | 更换套餐时跳过选择确认方式 | `false` |
| `SERVICE_CHANGE_ALL_CATEGORY` | 允许跨类别更换套餐 | 容器默认 `false` |
| `ORDER_SORTING` | 排序方式：`cost_asc`、`cost_desc`、`name_asc`、`name_desc`、`descr_asc`、`descr_desc` | `cost_asc` |
| `ORDER_COST_DISCOUNT` | 显示折扣后价格 | `true` |
| `ORDER_COST_WITH_BONUSES` | 同时按折扣和奖金显示价格，启用后优先于上一项 | `false` |
| `DEVICE_CONFIG_TEXT` | 自定义“添加到应用”按钮文案 | 随界面语言显示 |

## 登录、邮箱与安全

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `TELEGRAM_BOT_AUTH_PROFILE` | SHM 中的 Telegram 机器人配置名称 | `telegram_bot` |
| `TELEGRAM_WEBAPP_AUTH_ENABLE` | 启用 Telegram Web App 登录 | `false` |
| `TELEGRAM_WEBAPP_AUTO_AUTH_ENABLE` | 自动使用 Telegram Web App 登录 | `false` |
| `TELEGRAM_WEBAPP_PROFILE` | Web App 使用的机器人配置名称 | 未设置 |
| `ALLOW_TELEGRAM_PIN` | 允许绑定 Telegram 账户 | `true` |
| `OTP_ENABLE` | 显示动态验证码设置 | `true` |
| `PASSKEY_ENABLE` | 显示 Passkey 设置 | `true` |
| `PASSKEY_AUTH_DISABLED` | 隐藏 Passkey 登录按钮 | `false` |
| `CAPTCHA_ENABLED` | 启用验证码，还需在 SHM 管理后台配置 | `false` |
| `EMAIL_REQUIRED` | 要求用户先填写邮箱 | `false` |
| `EMAIL_VERIFY_REQUIRED` | 购买服务前要求验证邮箱 | `false` |
| `ALLOW_EMAIL_VERIFY` | 允许验证邮箱 | `true` |

Telegram OIDC 与其他认证方式是否可用，也取决于 SHM 服务端的认证配置。使用 Telegram Widget 时，需要在机器人设置中填写用户中心所在域名。

## 联系方式与法律文件

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SUPPORT_LINK` | 客服支持链接 | 未设置 |
| `CONTACT_EMAIL` | 联系邮箱 | 未设置 |
| `CONTACT_PHONE` | 联系电话 | 未设置 |
| `PRIVACY_POLICY_URL` | 隐私政策链接或路径 | 未设置 |
| `RETURN_POLICY_URL` | 退款政策链接或路径 | 未设置 |
| `TERMS_OF_USE_URL` | 使用条款链接或路径 | 未设置 |
| `PUBLIC_OFFER_URL` | 服务协议链接或路径 | 未设置 |
| `USER_AGREEMENT_URL` | 用户协议链接或路径 | 未设置 |

可将本地文件挂载到容器 `/app/docs/`，再使用 `/docs/文件名.pdf` 作为链接。

### 客服组件

支持嵌入 [Support Bot](https://github.com/bkeenke/support-bot) 等客服组件。脚本只在用户登录后加载，当前 SHM 用户 ID 自动填入 `data-user-id`。

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SUPPORT_WIDGET_URL` | 客服组件脚本地址 | 未设置 |
| `SUPPORT_WIDGET_API` | 传入 `data-api` 的组件 API 标识 | 未设置 |
| `BITRIX_WIDGET_SCRIPT_URL` | Bitrix24 客服组件脚本地址 | 未设置 |

例如：

```yaml
environment:
  SUPPORT_WIDGET_URL: "https://widget.example.com/widget.js"
  SUPPORT_WIDGET_API: "your-widget-key"
```

## Web Push 通知（试验功能）

通过 Service Worker 接收浏览器推送。设置 `WEB_PUSH_ENABLE=true` 和 `VAPID_PUBLIC_KEY` 后，用户可在登录后的页面顶部管理通知订阅。

1. 生成 VAPID 密钥，例如使用 `npx web-push generate-vapid-keys`。
2. 将公钥填入客户端的 `VAPID_PUBLIC_KEY`，私钥配置在 SHM 相关模板中。
3. 配置订阅和取消订阅模板；客户端使用 `/shm/v1/template/subscribe`、`/shm/v1/template/unsubscribe`。

SHM 需要配套模板才能处理推送订阅。iOS 需要 Safari 16.4+，并将应用添加到主屏幕后使用。

推送打开的 URL 可带 `_nt`（标题）和 `_nb`（内容），应用会显示对应通知：

```text
https://client.example.com/?_nt=服务通知&_nb=套餐已生效
```

## 安装为 PWA

支持在手机或桌面设备上安装为独立应用。安装时显示的名称、说明来自 `APP_NAME`、`APP_DESCRIPTION`；镜像构建时也应设置对应配置，以更新 PWA 清单。

自动安装提示在同一浏览器、同一站点首次满足条件时只显示一次，显示前即持久记录；刷新或退出再登录不重复提示。无法保存该标记时跳过自动提示，不影响原有手动安装指引。清理站点存储、更换浏览器或域名后可能再次出现。更新前端后，关闭此站点所有页面与已安装PWA窗口，再重新打开以加载新资源。

| 文件 | 推荐尺寸 | 用途 |
| --- | --- | --- |
| `icon-192.png` | 192×192 | Android／桌面主屏幕图标 |
| `icon-512.png` | 512×512 | 启动画面与大图标 |
| `screenshot-desktop.png` | 至少 1280×800，约 16:9 | 桌面安装预览 |
| `screenshot-mobile.png` | 至少 640×1136，约 9:16 | 手机安装预览 |

使用挂载替换图标或截图：

```yaml
volumes:
  - "./icon-192.png:/app/icon-192.png"
  - "./icon-512.png:/app/icon-512.png"
  - "./screenshot-desktop.png:/app/screenshot-desktop.png"
  - "./screenshot-mobile.png:/app/screenshot-mobile.png"
```

## 添加自定义语言

简体中文已经内置，无需额外安装。添加其他语言时：

1. 复制 `public/locales/en.json`，翻译值并保留键名、插值和标记。
2. 在根对象中提供语言说明，例如：

```json
{
  "config": {
    "code": "kk",
    "label": "Қазақша",
    "flag": "🇰🇿"
  }
}
```

3. 将完整翻译文件挂载到 `/app/locales/kk.json`，并设置 `CUSTOM_LANGS=kk`。多个代码用逗号分隔，例如 `kk,tr`。

```yaml
environment:
  CUSTOM_LANGS: "kk"
volumes:
  - "./kk.json:/app/locales/kk.json"
```

语言文件须提供 `config.label`、`config.flag`；代码应与文件名一致。应用会检查翻译覆盖率，少于英文键数 50% 的自定义语言会被忽略，并在控制台提示。

## 许可证

MIT。
