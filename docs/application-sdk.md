# 应用 SDK

应用统一使用 `@t-box/app-sdk` 的 `AppClient` 接口。公共核心不依赖 Vue、Capacitor、浏览器全局登录状态或具体应用业务。内置模块由 `app-shell-sdk` 适配，独立 Web 容器由 `app-web-sdk` 适配，服务端继续使用 `app-server-sdk`。

```text
应用 → AppClient → 内置适配器 / MessageChannel 适配器
                     → 宿主 sdkHost → 平台 API → 应用后端
```

## 独立应用入口

```ts
import { connectAppClient } from '@t-box/app-web-sdk'

const { client, context, ready } = await connectAppClient({
  // 名称必须与已发布版本的 clientTools 完全一致。这里注册前端工具，不注册 AI 业务。
  calculator_fill_expression: async (args) => fillExpression(args),
})

const session = await client.auth.ensureSignedIn()
const history = await client.storage.get('calculator.history.v1')
const result = await client.api.invoke('calculate', input, {
  idempotencyKey: operationId,
  signal: abortController.signal,
})

// 完成页面初始化后通知宿主，前端工具此时才可被调用。
ready()
window.addEventListener('pagehide', () => client.dispose(), { once: true })
```

`context` 是此安装的运行绑定：应用 ID、版本 ID、安装代次、应用范围用户标识、运行平台、导航参数、权限和能力列表。它不包含登录 token、真实账号 ID、模型凭证或原生插件对象。

## 内置应用入口

```ts
import { createShellApplication } from '@t-box/app-shell-sdk'

export const application = createShellApplication('calendar')

const session = await application.client.auth.getSession()
await application.client.storage.set('view', 'month')
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
| `files.pick/upload/read`                       | 按应用与安装代次授权的文件选择、上传、私有读取；需要 files 权限 |
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
  'books',
  { ledgerId },
  (event) => refreshLedger(event),
  { onError: (error) => showConnectionState(error.code) },
)
// 组件卸载、资源变化时停止旧订阅。
stop()
```

独立 Web 应用还必须获得 `events.${channel}` 权限；仅声明通道不足以授权。现有内置通道使用平台的 WebSocket 认证协议。独立远程后端实现 events 接口，宿主通过带游标的短轮询转接同一个 SDK 订阅接口；默认 5 秒，故障退避最多 60 秒，权限或安装失效即停止。游标和事件去重语义由应用提供，不能假定恰好投递一次。

实时订阅是当前页面的通知通道。AI 持久任务继续由后端执行，遇到前端交互时使用现有任务暂停/恢复机制，不依赖这个页面连接保持打开。

### 文件端口

发布版本显式声明 `files` 权限，升级时由用户授予，旧安装不会自动扩大权限。`client.files.pick({ multiple: true })` 由宿主弹系统选择器，上传后返回资源元数据；`upload(file)` 上传 File 或带 name 属性的 Blob；`read(id)` 返回元数据与 Blob。单文件最多 10 MB、一次最多 10 个，不限制文件扩展名，仍遵守账号总容量限制。通用资源页的上传类型限制与此独立应用端口不同。

宿主拥有登录凭据；应用只得到此用户、此应用、此安装代次的文件授权，不能读取另一个应用的资源。卸载重装后旧代次的文件授权失效，文件本身仍保留在用户资源中。关闭应用或切换账号会取消选择器及未完成请求；已成功上传的文件不会因为后续取消而自动删除。已有应用的专用附件入口保持其领域授权，并未一律迁移为这个通用端口。

### 独立后端执行前交互

需要运行中授权/确认的远程应用，在模块里声明 `interactions`，并在 `remoteApplicationModule(..., { preparation: true })` 启用协议。独立后端实现可选 `prepare(BackendPreparation)`，HTTP 端点为 `POST /prepare`：

1. 平台发送固定调用 ID、应用范围 subject、版本、代次、方法及参数；prepare 不允许写业务数据或触发外部副作用。
2. 后端返回 ready + 可选短期执行 ticket，或 interaction + continuation + 已声明的客户端动作。最多 8 次交互。
3. 宿主先执行动作，随后把回执送到 prepare。密码不得作为回执；前端应向应用授权端点换取绑定资源/操作的短期授权 token。回执、continuation 和执行 ticket 不写模型参数或工具结果。
4. 所有交互完成后，平台重新检查安装和资源授权，才记录工具派发并调用 invoke；ticket 仅通过独立字段 `preparationTicket` 传递。前端缺席时停在派发之前，恢复后重新准备，不重复业务写入。

后端必须验证 ticket 绑定的 subject、generation、releaseId、invocationId、参数摘要及有效期，原子消费并持久化相同调用 ID 的最终回执。不能只在内存里存一个“已同意”。执行阶段发生连接丢失仍进入原有不确定副作用核对流程，平台不会盲目重发写入。已发布旧远程绑定默认不启用 preparation，避免破坏旧服务。

### 独立后端事件

应用实现可选 `events(BackendEventRequest)`，HTTP 端点 `POST /events/poll`，返回 `{ cursor, events }`。批次最多 50 条、整个响应最多 256 KB，游标最多 4096 字符。宿主网关每次验证账号、安装版本、代次和 `events.<channel>` 授权；远程地址与服务凭据只由部署绑定决定，应用前端不能自选 URL。后端自行验证成员/资源权限，事件尽量只带变更 ID。授权或安装失效停止订阅，网络故障保留游标退避重连；应用按事件 ID 幂等刷新。该端口是轮询转接，并非已实现跨进程实时 WebSocket 总线。

### 新应用脚手架

在仓库根目录执行 `pnpm create:application notes 5180`，生成 `apps/notes/{contracts,server,web}`、manifest、build.config 与接入说明。模板包含统一 SDK 登录、文件选择、服务端方法与前端工具示例；拒绝覆盖已有目录。生成后按应用 README 注册组装入口、部署后端绑定，执行 `pnpm apps:workflow` 更新手动发布下拉列表。创建脚手架不会自动安装依赖、迁移数据库、授予权限或发布应用。

脚手架验证会实际编译 contracts/server、执行 Vue 类型检查和 Vite 构建。模板中的示例方法无写入副作用；添加写入前必须自行实现持久幂等回执和安装代次隔离。

## 扩展边界

公共 SDK 统一登录态、调用、事件、存储、导航、文件和生命周期；提醒能力通过 device.reminders 端口由宿主适配。资源密码授权仍由应用自己的权限接口与宿主交互协作，不提供跨应用的万能 token。摄像头、定位等新增设备能力必须单独声明权限与宿主适配，不能把账本或日历业务添加进公共 SDK。

SDK 协议 `APP_SDK_VERSION` 与已有应用发布协议 `APP_PROTOCOL` 分开。本轮为增量扩展，不修改已经发布的不可变版本定义；文件授权需要先执行数据库迁移，新能力要在新发布版本声明。应用和宿主发布时应协同升级 SDK；未知 SDK 版本会明确拒绝连接。

## 验证

- `pnpm test:app-sdk`：公共客户端生命周期、取消、错误、订阅及隔离通信适配器测试。
- `pnpm test:app-platform`：安装、卸载、版本代次、授权、运行上下文和后端隔离集成测试。
- `pnpm check:apps`：应用及公共包依赖边界检查。

## 应用更新发现与提示

宿主使用独立的 `/api/v1/app-market/ws` 平台连接同步应用目录，不依赖 AI socket。连接以消息提交现有登录凭证，服务端校验来源、登录有效性并定期复核会话。凭证不放在 URL。每个 API 进程在有订阅者时每 3 秒批量读取一次已发布目录、这些用户的安装记录与会话状态；指纹变化只推送 `catalog.changed` 和不透明 revision，客户端再读取鉴权目录。因此其他 API/worker 进程发布、安装完成也能被发现；草稿和仅提交审核的版本不会提示更新。通常约 3 秒内同步，属于近实时同步，非零延迟推送。

前端只有一个目录同步器：静默读取不会清空列表或触发加载闪烁；断线以指数退避重连，重新连接、窗口聚焦、联网或切回前台会补查。socket 不可用时，仅在前台每 60 秒补查；安装进行中或系统应用安装失败时，前台每 10 秒静默补查处理进度和既有修复流程。通知后的目录读取若暂时失败，也会每 10 秒补查，避免相同 revision 不再推送而丢失更新。更新不会自动安装、重载或切换正在运行的版本。

应用加载完成后，宿主检测其**已安装版本**与已发布版本是否不同（包括管理员回滚到旧版本），避开已打开的表单/密码弹窗后展示更新提示。点击「前往更新」进入 `#/applications/market?appId=<当前应用>`，自动打开应用详情和更新说明，用户确认权限后才更新。选择「稍后」后，同一用户、应用和目标版本在本标签页会话内不再打扰；新版本仍会提示。安装进行中、未安装或安装失败时不会弹版本更新提示。

发布定义可选声明：

```ts
updatePrompt: {
  mode: 'default', // 缺省使用系统弹窗；custom 使用 SDK 注册的应用弹窗
  title: '发现新版本',
  description: '新版本已上架，前往应用市场查看并更新。',
  confirmText: '前往更新',
  deferText: '稍后',
}
```

管理后台的版本表单可以维护这些字段，定义会随版本入库；Actions 构建提交也会保留应用声明。文案都是纯文本，不接受 HTML 模板、脚本或远程组件。发布版本不可直接修改，需通过新草稿发布。**提示策略在对应版本安装后生效**，最新待安装版本无法替正在运行的旧版本开启尚不存在的自定义 UI。

独立 Web 和内置应用都可使用公共 SDK：

```ts
// 在页面 ready() 前注册；已安装发布定义必须声明 mode: 'custom'。
const stopUpdates = await client.updates.registerPrompt((update, { signal }) => {
  const dialog = showMyUpdateDialog({
    title: `${update.name}有新版本`,
    version: update.version,
    notes: update.releaseNotes,
    onUpdate: () => client.updates.openMarket(),
    onLater: () => dialog.close(),
  })
  signal.addEventListener('abort', () => dialog.close(), { once: true })
  return true // UI 已显示才确认；不要等待用户点击后才返回
})

// 也可以按需查询，无需将版本信息或弹窗注册成 AI 工具。
const available = await client.updates.getAvailable()
// 页面释放时调用 stopUpdates()；client.dispose() 也会自动清理。
```

宿主留出 2 秒等待自定义处理器注册并确认显示。未注册、返回 false、抛错、超时或实例关闭时回退系统弹窗。超时、版本变化、离开应用或切换账号时 SDK 会取消旧提示；应用应按 AbortSignal 关闭自己的 UI，避免迟到弹窗与默认提示重叠。应答绑定应用实例和一次性 promptId，其他应用或旧请求不能隐藏当前提示。`updates.openMarket()` 只能由当前应用打开自身的市场详情，不接受跨应用 ID、任意 URL 或安装指令。

## 独立应用布局

宿主将独立应用 iframe 作为完整视口，移除外层页面 gutter、居中最大宽度和额外底部导航留白。应用正文自行排版；不要通过缩小 iframe 为正文留白，否则 iframe 内的 sheet、遮罩、固定元素也会一起缩进去。

内置 UI 工具包提供 `@t-box/ui-kit/application.css`，导入后在正文根节点使用 `application-frame`：移动端单层 12px 左右留白，桌面端 20px，默认最大宽度 1080px，可通过 `--application-content-width` 调整，并兼顾安全区域。此容器只约束正文，不设置 transform、contain 或 overflow 来约束弹层。

```ts
import '@t-box/ui-kit/base.css'
import '@t-box/ui-kit/application.css'
// Vue 根页面：<main class="application-frame">标题与正文</main>
```

`BottomSheet` 已 Teleport 到应用自己的 body，并通过 dialog 顶层绘制；手机端铺满该视口宽度，桌面端保留 560px 面板宽度上限。Modal 和 SidePanel 同样以应用视口定位。应用应在自己的文档内展示标题栏并通过 SDK 返回，让弹层能覆盖标题区域，避免把业务标题留在 iframe 外。兼容原本使用宿主标题栏的应用时，先检查 `context.supportsAppNavigation`，支持才渲染自己的标题栏并调用 `ready({ appNavigation: true })`。宿主收到已验证的就绪消息后隐藏旧标题栏；旧版应用不声明时仍保留返回入口，旧宿主也不会因新版应用而出现双标题。

应用 iframe 的统一沙箱策略允许 scripts、same-origin、forms 和 downloads；`allow-forms` 是 Vue `@submit.prevent` 等本地表单处理收到 submit 事件的必要条件，不能只因应用不使用原生 POST 就禁用它。应用仍使用独立来源，未开放顶层导航和弹出窗口；静态产物服务继续设置 CSP `form-action 'none'`，阻止未被拦截的原生表单跳转。
