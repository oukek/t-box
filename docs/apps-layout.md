# 应用代码目录与宿主边界

所有当前应用的页面、契约和领域实现由 `apps/` 下各自的 workspace 包维护。`app` 和 `api` 是组合与运行宿主，应用通过公开 SDK/包入口接入，不允许跨目录导入宿主内部文件。

| 目录              | 应用类型                     | 内容                                                                                        | 当前前端运行方式  |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------- | ----------------- |
| `apps/ledger`     | 用户应用，可卸载             | contracts、web、server；账本、分类、账单、往来、统计、授权、REST、实时订阅、AI 工具与 Agent | 独立来源 Web 容器 |
| `apps/calculator` | 系统应用                     | contracts、独立 web、server、shell；数学计算、REST、AI 工具、发布定义与历史迁移             | 独立来源 Web 容器 |
| `apps/calendar`   | 系统应用                     | contracts、web、server；日程/纪念日、重复规则、备份、提醒、权限与 AI 工具                   | 独立来源 Web 容器 |
| `apps/time`       | 系统应用                     | contracts、web、server；世界时钟、倒计时、秒表、时间计算与 AI 工具                          | 独立来源 Web 容器 |
| `apps/settings`   | 系统应用，历史 ID 为 profile | contracts、web；账号页面、密码弹窗、关于和图标大小                                          | 宿主内置模块      |
| `apps/market`     | 系统应用                     | contracts、web；目录、版本、安装/更新/卸载页面                                              | 宿主内置模块      |
| `apps/images`     | AI 能力模块，无 OS 图标      | server；图片技能、工具和 Agent，接收图片处理服务端口                                        | 无独立页面        |

每个包有自己的 package.json、tsconfig 和类型检查。contracts 与 server 编译到各自 dist；四个独立 Web 应用使用 app-web-sdk 消息桥，经主机转发受控业务与设备能力。设置、市场和宿主 shell 以源码包由宿主 Vite 编译，保留跨 workspace HMR。生产由 OSS 提供独立静态版本，后端能力仍随 API 部署；不能把特权 shell SDK 放进第三方 iframe。操作顺序见 [首次部署](first-deployment.md)。

## 公共包

- `app-contracts`：应用清单、资源引用、工具/交互声明、发布、安装及消息协议。没有应用业务实现。
- `app-server-sdk`：受限工具上下文、技能/Agent 契约、工具 schema 与独立 HTTP 后端协议。
- `app-web-sdk`：独立来源 Web 应用的 MessageChannel 桥。
- `app-sdk`：框架无关的公共应用客户端，统一登录态、调用、事件、存储和生命周期。
- `app-shell-sdk` / `app-web-sdk`：同一公共客户端的内置与独立 Web 适配器；shell 另保留可信系统模块的特权兼容端口。
- `ui-kit`：自有组件、应用标题栏、图标、日期/时间 Sheet、图表和纯展示帮助函数。没有账号、网络或应用领域依赖。
- `dayjs`：前后端共用的 Day.js 插件与中文配置入口；边界输入使用严格日期和夏令时校验。农历、节气和节假日数据属于日历应用。
- `server-foundation`：API 错误、输入/密码校验、密码哈希、UTC 时间转换、通用持久化幂等事务；没有应用实现依赖。
- `device-reminders`：跨日历/时间的设备通知适配、调度及通用提醒 UI，统一处理 Capacitor 权限和账号切换。

`shared` 保留历史兼容导出及宿主对话/账号/计费 DTO。记账、日历、时间的实际类型、纯函数和清单来自各自 contracts，不在 shared 再实现一份。

## 宿主提供哪些能力

`app/src/applications/shellAdapter.ts` 在挂载 Vue 前注入请求、幂等写入、导航、账号操作、桌面偏好和应用目录操作，并同步公开状态。应用通过 SDK 使用这些能力，不导入 app/src/core 或 features/identity。

公开 identity 只有账号信息和恢复状态，没有登录 token。账本实时连接由宿主创建并完成认证，应用只处理订阅及业务消息。修改账号密码使用独立宿主方法，账号令牌清理仍由宿主负责。此接口面向可信第一方模块，不是第三方代码隔离沙箱；服务端继续执行登录、成员权限、密码授权和安装撤权检查。

服务端注册入口 `api/src/applications/registry.ts` 组合 apps 的公开模块；PlatformService 注入数据源与服务端口。记账不接收 IdentityService 的具体类，只接收身份校验/限流接口。图片工具只接收 ImageToolPort，模型密钥、资源存储和计费仍属于平台服务。设置和市场通过平台的账号/应用安装 API 工作，不重复建立另一套后台或数据库。

数据库实体由所属应用导出、主 API 数据源统一注册。已有迁移保留在 API 的有序迁移链：部分历史迁移同时创建账号和业务结构，不能为了目录形式拆开或重排已执行的迁移。应用 ID、版本号、工具名称、URL、表名及历史不可变发布定义均保持兼容。

## 开发和验证

```bash
pnpm install
pnpm build:contracts        # 按 workspace 依赖顺序编译 contracts、SDK、server
pnpm dev                   # 宿主、API、后台、独立计算器、产物服务和包 watch
pnpm dev:packages          # 单独运行公共包和应用后端/契约 watch
pnpm check:apps            # 导入边界、源文件存在性、显式依赖及层级检查
pnpm typecheck
pnpm build
pnpm test
pnpm test:ui-components
pnpm test:ledgers
pnpm test:calendar-time
pnpm test:desktop
pnpm test:app-platform
pnpm test:app-publishing
```

`check:apps` 禁止应用通过相对路径跨出自身包，要求依赖显式声明，防止 contracts 导入运行层、前后端互相依赖或公共基础包反向依赖应用。发布、安装、权限与发行方式的详细规则见 [独立应用平台](application-platform.md)。

公共 SDK 的接入方式、权限与兼容边界见 [application-sdk.md](./application-sdk.md)。
