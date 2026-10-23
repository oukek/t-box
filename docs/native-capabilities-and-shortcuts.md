# 原生能力、快捷指令与应用市场控制

本轮实施约定（2026-10-23）。沿用应用 SDK 和隔离通信，不把 Capacitor 或业务逻辑注入独立应用。

## 边界

- 应用只调用 `@t-box/app-sdk`，宿主负责设备能力发现、参数校验、应用授权、系统权限与确认。
- 设备能力不因未登录或断网而被整体禁用；云端业务仍验证登录、成员身份、安装版本和资源权限。
- 拨号返回系统已受理，不声称电话已接通；日历先提供系统编辑器，读取和管理需要完整权限。
- 原生系统授权属于整个宿主；每个内部应用仍须独立获准使用对应能力。
- 快捷指令使用编译进宿主的 App Intents。动态应用可以作为实体选项，不动态加载 Swift。
- 冷启动请求持久保存并在宿主就绪后投递；成功确认前不删除。可能已写入的操作不盲目重试。
- 当前保持 iOS 15.4 基线；App Intents 在 iOS 16+、新日历权限在 iOS 17+按可用性启用。

## 应用市场开关

后台应用管理提供“隐藏应用市场”。配置存放在平台配置表的独立 `host.applicationMarket` 命名空间，使用现有 Redis 修订号缓存；不加入 AI 配置页面。

隐藏后：桌面不显示市场；市场只提供已安装应用的维护入口；用户安装请求在服务端拒绝。已安装应用继续运行、更新、卸载和修复，系统默认应用初始化不受影响。安装与开关更新的并发通过数据库配置行锁排序。实时目录通知携带配置变更，离线沿用最后读取的显示设置，服务端始终重新校验。

## 实施检查

- [x] 后台开关、公共读取、Redis 缓存、修订通知与服务端安装控制。
- [x] 应用 SDK 类型、结构化错误、设备能力注册表与授权管理。
- [x] iOS 拨号、日历编辑/查询/修改/删除、分享、系统设置。
- [x] 日历应用的添加到系统日历入口。
- [x] App Intents、应用选择、冷启动持久交接、深度链接。
- [x] 原生会话 Keychain 与后台云端动作的受限调用。
- [x] 类型、权限/离线/幂等测试与 iOS 模拟器构建。

新增设备能力必须使用明确的方法和输入类型；不增加任意 URL、任意 Swift 方法、任意文件路径执行接口。应用声明、AI 工具和快捷指令暴露分别选择，应用业务逻辑保留在 `apps/`。

## 应用接入

设备能力由应用声明，默认不自动授权。随宿主编译的应用在 `ClientApplicationModule.sdk.deviceCapabilities` 中声明；独立发布的应用在 release 的 `permissions` 中声明，例如 `device.phone.dial`、`device.calendar.presentCreate`。安装授权不代替本机用户同意。

```ts
const environment = await client.device.getCapabilities()
const available = environment.capabilities.find(
  (item) => item.capability === 'calendar.presentCreate',
)
if (available?.supported && available.declared) {
  await client.device.calendar.presentCreate({
    title: '家庭聚会',
    startAt: '2026-11-01T10:00:00+08:00',
    endAt: '2026-11-01T12:00:00+08:00',
    timeZone: 'Asia/Shanghai',
  }, { idempotencyKey: operationId })
}
```

也提供 `phone.dial`、`calendar.create/list/update/remove`、`share.present` 和 `system.openSettings`。日历查询最多一年，返回最多 100 条且限制总字节数，`truncated` 表示结果被截断；它不是全量备份接口。修改、删除只作用于当前一次重复事件。网页只声明实际可用的拨号/分享；Android 当前返回未支持，不冒充 iOS 能力。

应用单独授权按本机账号和应用隔离。宿主的设备权限页可以撤销；匿名本地模式可以从桌面提示条进入该页。系统日历权限会在实际访问时重新验证，不依赖缓存的应用授权状态。

## 快捷动作和 AI 工具分开声明

后端 `ApplicationBackend.actions` 或独立服务的 release `actions` 声明可供系统使用的动作；不自动把 AI 工具全部导出。动作 `id` 指向应用已有后端 `invoke` 方法，并仍需对应安装 grant。动作结构包含 `version`、`title`、`inputSchema`、`effect`、`background`。参数/结果协议发生破坏性变化时提升动作 version，而不是在宿主写业务兼容。

```ts
await client.automation.saveShortcut({
  title: '常用单位换算',
  actionId: 'convert',
  actionVersion: 1,
  arguments: { category: 'length', value: '1', from: 'm', to: ['cm'] },
})
```

调用会弹出宿主确认窗口，之后在 iOS 快捷指令中选择“执行 T方舟 快捷动作”和已保存的动作。SDK 不会擅自创建或运行系统自动化。计算器历史和单位换算结果已经提供保存按钮；系统集成设置页管理已保存动作。

动态时间通过 `runtimeBindings` 显式声明 JSON Pointer，例如 `{ '/records/0/occurredAt': 'now' }`。只允许把已有文本字段替换为当前 ISO 时间 `now` 或本机公历日期 `today`，不执行脚本、不创建任意字段。同一次执行的动态参数只求值一次；网络重试复用相同参数和请求标识。宝宝照护的后端动作已开放给 SDK，应用可以用这一机制提供不同的照护快捷入口。

本地内置应用可以请求保存云端动作，但仍须登录、联网并取得后端已安装动作的相同协议版本；不会因此获得基线应用原本没有的 `api.invoke`/云端文件权限。模板固定后端 release/generation，应用更新、卸载或撤销权限后再次执行会被服务端拒绝，需重新保存。

## 原生登录与执行

- 登录后宿主申请专用 `n1_` 凭据并写入 Keychain。普通业务 API 不接受该凭据。
- 凭据最长 7 天，且每次执行都检查父登录会话、用户启用状态和应用安装。退出登录或撤销设备后失效。
- 快捷指令后台动作要求系统认证；加密资源等需要前端交互的动作应声明 `background: false`，通过前台入口继续，不能绕过应用原有权限挑战。
- 已知业务失败直接返回明确错误。临时网络失败最多重试 3 次，使用同一幂等键；结果不确定时明确要求核对，不自动换新请求重写。
- 本机直接写入先持久化 pending 回执，进程退出后不盲目执行第二次。未决回执一直保留，已完成回执保留 7 天。
- 快捷指令打开请求保存到本机，绑定发起账号；等宿主、目标应用 SDK 握手完成后才确认接收。账号切换不投递旧账号请求。
- iOS 原生消息桥仅接受配置中可信来源的主 frame。嵌入应用即使直接调用 `window.webkit.messageHandlers.bridge`，也不能绕过宿主 SDK 调用任何原生插件。

## 构建和验证

```bash
pnpm native:ios
# 开发：先运行 pnpm dev，再在另一终端执行
pnpm native:dev:ios -- --url http://电脑局域网IP:5173
```

发行前在 `app/.env.production.local` 配置 `VITE_API_BASE_URL=https://你的域名/api/v1`。Release 的原生云端动作只接受 HTTPS，Debug 可连接局域网开发服务。`native:ios` 会构建网页、打入本地系统应用资源并同步 CocoaPods；Xcode 中选择开发团队和签名后 Archive/分发。模拟器构建不等于已验证真实拨号或所有系统权限交互，仍需真机验收。

自定义链接：`tbox://open/calculator?expression=1%2B1`。Universal Links 在 `capacitor/navigation.config.json` 配置 HTTPS origin 和 Apple Team ID，执行 native sync 后把 `capacitor/generated/navigation/apple-app-site-association` 部署到域名的 `/.well-known/apple-app-site-association`；生成文件会合并微信所需路径。HTTPS 链接格式为 `https://你的域名/open/calculator?expression=1%2B1`，未安装原生程序时由网页转换为对应应用路由。链接仅导航，不接受密码和令牌，也不直接执行写入。

验收命令：`pnpm test:native-platform`、`pnpm test:ui-components`、`pnpm test:app-sdk`、`pnpm test:native`。数据库集成测试创建随机测试数据库，结束后清理，不修改本地业务库。


本轮验证：完整 `pnpm check`、API 单元测试、前端组件测试、SDK 测试、MySQL 独立测试库集成测试、原生 Swift/资源测试及 iOS 模拟器编译均通过。真机拨号、系统日历授权交互和签名导出仍由实际设备与开发者签名配置验收，不将模拟器编译描述为真机验证。

## 网页端与客户端下载引导

网页调用本机专有能力时，由宿主统一弹出下载提示；应用继续通过 SDK 请求能力，不需要拼下载链接。仅查询能力不会弹窗。网页能够完成的拨号、系统分享继续使用浏览器实现，本地计算等功能不受影响。

- 设置中的快捷指令入口（包含直接访问链接）、SDK 保存快捷指令、系统日历调用、后台通知入口均接入下载提示。设备权限页仍可查看及撤销浏览器授权，本机权限入口提供 App 引导。
- iPhone、iPad（含桌面模式）使用 App Store 详情页。电脑端按功能支持范围显示下载选项；仅在 iOS 实现的能力明确说明需要 iPhone / iPad，不承诺 Android 可用。
- 后台「应用版本 → 客户端下载」配置提示中的应用名称、iOS App Store 详情页及 Android 官方下载地址。此配置不修改原生包名、快捷指令名称或品牌名称。
- 配置保存在 `platform_configurations` 的 `host.downloads`，使用已有 Redis 修订缓存和管理操作审计；与 AI 配置、内置应用市场隐藏策略分开管理。公共接口 `GET /api/v1/host/downloads` 无需登录。
- 尚未上架时保留空地址，提示“下载地址暂未开放”；不跳转 App Store 搜索或使用虚构链接。缓存过配置后，离线时仍显示缓存地址，并说明无法获取最新配置。

