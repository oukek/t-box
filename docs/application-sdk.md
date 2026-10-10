# 应用 SDK

应用统一使用 `@t-box/app-sdk` 的 `AppClient` 接口。公共核心不依赖 Vue、Capacitor、浏览器全局登录状态或具体应用业务。内置模块由 `app-shell-sdk` 适配，独立 Web 容器由 `app-web-sdk` 适配，服务端继续使用 `app-server-sdk`。

```text
应用 → AppClient → 内置适配器 / MessageChannel 适配器
                     → 宿主 sdkHost → 平台 API → 应用后端
```

## 独立应用入口

```ts
import { connectAppClient } from "@t-box/app-web-sdk";

const { client, context, ready } = await connectAppClient({
  // 名称必须与已发布版本的 clientTools 完全一致。这里注册前端工具，不注册 AI 业务。
  calculator_fill_expression: async (args) => fillExpression(args),
});

const session = await client.auth.ensureSignedIn();
const history = await client.storage.get("calculator.history.v1");
const result = await client.api.invoke("calculate", input, {
  idempotencyKey: operationId,
  signal: abortController.signal,
});

// 完成页面初始化后通知宿主，前端工具此时才可被调用。
ready();
window.addEventListener("pagehide", () => client.dispose(), { once: true });
```

`context` 是此安装的运行绑定：应用 ID、版本 ID、安装代次、应用范围用户标识、运行平台、导航参数、权限和能力列表。它不包含登录 token、真实账号 ID、模型凭证或原生插件对象。

## 内置应用入口

```ts
import { createShellApplication } from "@t-box/app-shell-sdk";
export const application = createShellApplication("calendar");

const session = await application.client.auth.getSession();
await application.client.storage.set("view", "month");
```

内置模块通过同一个 `AppClient` 使用公共能力。`createShellApplication` 延迟连接宿主；宿主初始化前可以安全导入应用。应用更新、卸载导致旧客户端关闭后，再读取 `application.client` 会获得新的客户端。

当前记账、日历、时间的历史 REST 接口通过 `application.request` / `application.mutation` 保留。它们是**仅适用于编译时可信内置模块的迁移接口**，不是独立 Web 应用的能力。应用在 `module.sdk.restPrefixes` 注册自身接口范围；宿主拒绝跨应用路径、路径穿越和非内置运行类型，并校验安装状态。它们保留原 REST 返回结构及写入幂等行为。

内置模块的账号资料、设置和市场特权仍属于 `app-shell-sdk`；目录独立不等于同源 JavaScript 安全隔离。需要独立发布或接入第三方应用时，使用独立来源的 Web 容器，并把业务 API 注册到应用后端。不要给第三方应用复制这些特权兼容接口。

## 公共接口

| 接口                                           | 用途                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `auth.getSession()`                            | 登录状态和应用范围身份；获得 `profile.read` 权限才返回昵称         |
| `auth.ensureSignedIn()`                        | 检查登录状态；未登录返回 `AUTH_REQUIRED`，登录表单由宿主提供       |
| `auth.onChange(fn)`                            | 监听恢复、登录、退出及会话替换；返回取消监听函数                   |
| `api.invoke(method, args, options)`            | 调用当前应用的方法，不接受应用 ID、任意 URL 或 bearer token        |
| `storage.get/set/remove`                       | 使用宿主来源中按应用与用户隔离的存储；不依赖 iframe 第三方存储权限 |
| `events.subscribe(channel, args, fn, options)` | 订阅已注册通道；返回取消订阅函数；可传 `signal` 和 `onError`       |
| `permissions.list/has`                         | 查询安装时授予的权限；仅用于界面提示，后端仍验证权限               |
| `navigation.open(params)`                      | 导航到当前应用自己的页面                                           |
| `navigation.back()`                            | 当前应用返回宿主                                                   |
| `runtime.getContext/supports/onClose`          | 获取绑定、检测能力、监听安装状态变化或关闭                         |
| `dispose()`                                    | 取消请求、清理监听与订阅、关闭传输；可重复调用                     |

### 登录及生命周期

宿主持有账号 token，并负责请求鉴权。应用不能读取或刷新 token，不能调用公共 SDK 修改全局账号密码或退出其他应用。

账号切换、会话替换、退出时，公共客户端取消旧请求和旧事件订阅；独立容器的连接关闭，必须重新打开。内置客户端可以继续查询新会话，但应重新建立业务订阅。恢复中的 `subject` 为 `null`，只有 `signed_in` 且完成运行绑定后才能使用用户存储。

服务端 `/applications/:id/context` 同时支持内置与独立 Web 应用，每次检查平台、安装状态、授权。独立容器绑定固定的版本和安装代次；版本或代次改变后，旧通道不再继续操作。客户端缓存只能用于显示，不能替代后端鉴权。

### 后端调用和写入结果

发布版本声明 `${appId}.${method}` 权限，安装时取得该授权。平台调用网关验证账号、安装版本、代次和方法权限，再把应用范围 `subject` 转发给应用后端。内置后端和独立后端使用同样的调用契约。

请求默认 15 秒超时，可设置 1～120000 毫秒。客户端提供取消机制，但取消或超时不保证服务器已经撤销写入。SDK **不会自动重试写入**；结果未知时，使用原 `idempotencyKey` 查询或重试，不能重新生成操作 ID。

`AppSdkError` 保留 `code`、`message`、可选 `status`，通过 MessageChannel 传输时使用普通结构化对象。业务可以区分权限不足、登录变化、版本失效和网络失败。

### 实时事件

应用负责注册通道名称及业务订阅参数，宿主负责认证、连接、重连和取消。记账应用在自己的模块里注册 `books` 通道，宿主通用层没有账本 ID 解析或账单处理逻辑。

```ts
const stop = await application.client.events.subscribe(
  "books",
  { ledgerId },
  (event) => refreshLedger(event),
  { onError: (error) => showConnectionState(error.code) },
);
// 组件卸载、资源变化时停止旧订阅。
stop();
```

独立 Web 应用还必须获得 `events.${channel}` 权限；仅声明通道不足以授权。现有通道使用平台的 WebSocket 认证协议，独立远程后端的推送协议尚未接入此注册机制。

实时订阅是当前页面的通知通道。AI 持久任务继续由后端执行，遇到前端交互时使用现有任务暂停/恢复机制，不依赖这个页面连接保持打开。

## 扩展边界

本轮完成登录态、调用、事件、存储、导航及生命周期统一。文件选择/上传、资源临时授权弹窗、原生设备能力暂沿用现有实现，尚未纳入公共 SDK。后续扩展应新增明确能力契约和宿主适配器，不把账本或日历业务添加进公共 SDK。

SDK 协议 `APP_SDK_VERSION` 与已有应用发布协议 `APP_PROTOCOL` 分开。本轮为增量扩展，不修改已经发布的不可变版本定义，也不要求数据库表迁移。应用和宿主发布时应协同升级 SDK；未知 SDK 版本会明确拒绝连接。

## 验证

- `pnpm test:app-sdk`：公共客户端生命周期、取消、错误、订阅及隔离通信适配器测试。
- `pnpm test:app-platform`：安装、卸载、版本代次、授权、运行上下文和后端隔离集成测试。
- `pnpm check:apps`：应用及公共包依赖边界检查。
