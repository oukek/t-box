# Capacitor 原生壳

`app` 管理 Vue 业务代码，`capacitor` 管理 iOS / Android 原生工程，`capacitor-plugins/*` 管理本地原生插件。继续使用 Capacitor 8.5.2 和 CocoaPods。

## 构建与同步

```bash
pnpm --filter @t-box/capacitor sync
pnpm --filter @t-box/capacitor open:ios
pnpm --filter @t-box/capacitor open:android
pnpm native:run:ios
pnpm native:run:android
```

`sync` / `open` / `run` 依次同步原生版本、构建 shared 与 app、清理并复制 `app/dist` 到 `capacitor/www`、执行 `cap sync`。`www` 是生成目录。浏览器部署使用 `app/dist`，无需依赖原生壳。

生产 API 地址在 `app/.env.production.local` 中设置 `VITE_API_BASE_URL=https://api.example.com/api/v1`，详细说明见根目录 README。

## 版本

原生发行版本以 `capacitor/package.json` 的 `version` 为准，格式为 `1.2.3`。同步到 Android `versionName` 和 iOS `MARKETING_VERSION`。网页“关于”版本仍来自 `app/package.json`；发行时应同时调整这两个文件。

```bash
APP_BUILD_NUMBER=123 pnpm native:sync
pnpm native:version # 只更新版本，不构建网页
```

构建号优先读取 `APP_BUILD_NUMBER`，其次读取 `GITHUB_RUN_NUMBER`，范围为 1–2100000000。本地未指定时保留已有构建号。每次正式发布需使用递增构建号。

## 开发热更新

保持 `pnpm dev` 运行，再执行 `pnpm native:dev:ios` 或 `pnpm native:dev:android`。支持 `--url http://192.168.1.10:5173` 和 `--run`，也支持 `CAP_LIVE_RELOAD_URL`（兼容参考项目的 `CAP_SERVER_URL`）。

热更新已有 `www/index.html` 时复用网页资源。正式 `sync` / `open` / `run` 会重新构建，并清除两种开发地址环境变量，避免把局域网地址打进发行包。直接调用 `cap` 不经过此保护，发行使用上述封装命令。

## 原生插件

`@t-box/capacitor-native-scanner` 已在 app 和原生壳中通过 `workspace:*` 引用。Android 使用 ZXing，iOS 使用 AVFoundation；iOS 相机用途说明已配置，Android 权限由插件 manifest 合并。

新增插件时放入 `capacitor-plugins/<name>`，在 app 和 capacitor 的 dependencies 中引用同一 workspace 包，然后执行 `pnpm install` 和 `pnpm native:sync`。保留 JS/类型入口、Android library、iOS podspec 和 package.json 的 `capacitor` 平台声明。

本次只接入构建与插件注册，业务页面尚未添加扫码入口。签名和发布继续使用 Xcode / Android Studio；未接入参考项目的 OSS 或 TestFlight 上传配置。

## 微信 APP 支付

当前 iOS 壳的 AI 余额充值入口固定禁用，显示「iOS 应用内购暂时不可用」，仅保留余额与订单查看；后台 APP 通道开关不会解除该限制。Android 充值继续使用微信 APP 支付。网页不受此 iOS 壳限制。

已通过本地 `@t-box/capacitor-wechat-pay` 插件接入 iOS / Android 官方 OpenSDK。公开打包身份在 `wechat.config.json`（默认关闭），商户凭证和独立 APP 通道在后台支付配置中管理。所有 native sync / dev 命令会先同步公开身份。配置、Universal Link 域名文件部署和真机验证详见 [微信原生支付](../docs/wechat-native-payments.md)。

## 设备能力和快捷指令

`@t-box/capacitor-device-runtime` 提供 iOS 拨号、系统日历、分享、设备设置、按应用授权、Keychain 会话与持久快捷请求。独立应用通过统一应用 SDK 使用，不能直接访问原生插件。原生主页面已增加桥接来源检查，嵌入应用不能直接发送原生调用。

iOS 16+ 的快捷指令可以选择“打开 T方舟 应用”或“执行 T方舟 快捷动作”。计算器历史、单位换算结果可保存动作；设置 → 系统集成中管理权限和快捷动作。未配置云端地址或未登录不影响本地工具与本机能力。

可选 Universal Links 在 `navigation.config.json` 配置，原生同步时自动生成关联文件并保留微信配置。完整接入及验收见 [原生能力与快捷指令](../docs/native-capabilities-and-shortcuts.md)。

iOS 和 Android 的原生显示名称按系统语言区分：中文为「T方舟」，其他语言为「T Ark」。Capacitor 的默认 `appName` 使用英文名；iOS 的 `InfoPlist.strings`、Android 的 `values-zh/strings.xml` 提供中文名称。改名不改变 `com.tbox.app` 或既有快捷链接协议。
