# 独立应用平台

独立构建与后台提交链路见 [GitHub Actions 应用发布](application-actions-release.md)。CI 只能登记指定应用的已提交版本，不能发布或修改后端能力声明。

当前应用的实现均已迁入 `apps` workspace：记账、计算器、日历、时间、设置、市场，以及图片 AI 能力模块。页面、领域服务、REST、工具与契约各归所属应用；宿主保留组合、通用通讯、身份与平台运行服务。计算器和记账已有独立 Web 产物；日历、时间、设置和市场仍以可信内置模块运行。记账是可卸载用户应用，其余桌面应用是不可卸载、可升级系统应用。安装健康与记账迁移见 [安装与故障隔离](application-installation-health.md)。完整目录及包边界见 [应用代码目录](apps-layout.md)。

## 目录与依赖

```
apps/calculator/
  app.manifest.ts         应用入口声明
  contracts/src/          数学类型、校验、纯计算实现；前后端共用
  server/src/             工具、专业 Agent、导航、后端调用与安装钩子
  web/src/                独立 Vite/Vue 页面；不导入宿主状态或 API 内部
packages/
  app-contracts/          通用发布、安装、生命周期、网关、消息桥契约
  app-server-sdk/         服务端工具上下文与独立 HTTP 服务边界
  app-web-sdk/            MessageChannel 通讯
  ui-kit/                自己实现的通用组件及基础样式；无用户/AI/业务依赖
api/src/application-platform/
  catalog.ts             可信部署的组合入口
  deployment.ts          正式 Web 产物和来源配置校验
  service.ts             安装授权、网关、生命周期队列与恢复
  adapters/remote.ts      独立后端服务调用
```

`shared` 对应用类型和清单保留兼容 re-export；实际实现位于应用自己的 contracts 包。计算器的兼容 REST 入口也由 apps/calculator/server 提供，AI 执行器不包含应用业务逻辑。新应用依照 SDK 提供能力，宿主可以从可信目录创建通用 Web 容器，无需把远程 Vue 组件导入宿主。

## 注册、发布与安装

服务注册是部署操作：显式组合可信 AppRelease、后端 binding 和可选 AI 模块。用户安装只能选择已经发布的版本，不能提供 URL、服务密钥或可执行文件路径。独立后端不需要把业务代码放入本 API；但首次登记服务 binding 和工具契约仍需要可信部署配置，当前没有第三方开发者自助发布系统或签名审核后台。

数据库包含以下独立表：

- `application_registry`：固定的应用类型与应用级发布锁。
- `application_releases`：版本定义、摘要、更新说明、草稿修订号和提交/发布信息；提交后定义不可变。
- `application_publication_events`：管理员操作、版本、时间与审计详情。
- `application_installations`：用户与应用的稳定关系、安装代次、当前/目标版本、状态与权限。
- `application_lifecycle_operations`：固定 operationId、请求摘要、任务租约、提交标记、回执及下一次核对时间。与既有业务幂等表 `application_operations` 分开。

默认预装会走安装流程，`INSERT IGNORE` 保留卸载墓碑，刷新桌面不会重新安装已卸载应用。应用数据不依赖安装行做级联删除。系统应用不可卸载；记账是当前可卸载的用户应用，已有账户保留预装体验。卸载后账本、共享关系和统计数据保留，REST、AI 和实时订阅入口撤权；重新安装恢复访问。应用级别的类型保存在 `application_registry`，不允许通过修改版本绕过卸载策略，历史不可变发布定义不回写。

安装先事务写入 installing、操作及队列，再在事务外调用后端。确认成功才激活权限。远程超时保留 pending；恢复时先用原 operationId 查询结果，无确定结果时按同一标识调用幂等 ensure。每个用户/应用串行、租约 token 和 generation 防止迟到回执激活新的安装。

更新准备期间旧版本仍可用，新增权限必须明确接受。卸载先撤销权限再清理；远程清理未确认时不能重新安装，以免旧清理误伤新代次。卸载不删除业务数据。所有生命周期状态可离开页面后继续恢复。

## 独立后端协议

后端部署绑定使用服务端配置的 HTTPS 基址和私有凭证，HTTP 只允许本机开发。请求禁止自动重定向。凭证不返回前端或模型；远程只收到应用范围的 subject、版本、代次、操作标识及必要参数，不接收主站登录 token、sessionHash 或完整账号对象。

`@t-box/app-server-sdk` 提供 `ApplicationBackend`、`bindRemoteTools` 与 `createApplicationBackendHandler`，可嵌入独立 Node 服务：

- `POST /lifecycle/ensure`：LifecycleRequest，返回 completed/pending/rejected。
- `POST /lifecycle/status`：原 LifecycleRequest，返回原回执，尚无记录时 null。
- `POST /invoke`：BackendInvocation，含固定 invocationId、method 与 arguments。

`remoteApplicationModule` 在组合层绑定远程工具；工具经统一 AI journal 执行，SDK 收到该应用的固定 callId、已安装 releaseId 和 generation，再经网关发往远程服务。内置和外部 AI 模块都会统一应用安装检查。

服务端必须在自己的数据库实现 operationId 唯一约束、请求摘要冲突检查、原回执保存及代次防护；协议包装器不是业务幂等数据库。涉及写入的 invoke 也必须保存 invocationId 结果。确认需求应在副作用之前，通过 SDK 的确认/资源授权接口停在持久任务边界，不能在已提交写入的 handler 中等待前端再继续副作用。当前独立 HTTP 网关没有通用远程 `interaction_required` 续办协议；远程工具需以组合层的 SDK 适配器先确认再执行。

## 前端容器和工具

计算器运行在独立来源的 iframe，sandbox 仅开放脚本和应用自身来源，不授予顶层导航、弹窗、表单、摄像头或原生插件。禁止与宿主同源运行。宿主把消息发送到服务端登记的精确 origin，并绑定具体 iframe、nonce 和专属 MessageChannel；工具清单必须与发布版本完全一致。

消息桥暴露限定 RPC：应用网关请求、按用户/应用隔离的本地存储。主站 token 始终由宿主持有。每次调用重新确认版本和安装代次；注销、关闭或重新加载容器会关闭旧通道。应用完成初始化和挂载后调用 SDK 的 `ready()`，初始化期间只能发起受限 RPC，AI 工具会等待就绪。

数学工具在后端执行，客户端断开不影响这些计算。`calculator_fill_expression` 是前端工具，只把表达式填入页面。AI 使用应用工具名，宿主经 `application_invoke` 载入应用、等待握手、派发工具。没有客户端时沿用 waiting_client checkpoint；连接回来继续，不重发用户消息或自动确认。

AI 模型列表按安装授权过滤；执行前、缓存回执重放前和确认后也检查权限。任务记录已使用模块的能力摘要与安装版本，安装代次或相关工具版本改变会拒绝继续；不再因增加无关应用直接使所有新任务失效。旧 checkpoint 仍按旧全局 revision 规则处理。历史数据的资源权限适配器继续注册，不随卸载删除。

## REST API

所有接口要求主站用户登录，操作只作用于当前用户：

| 接口 | 用途 |
| --- | --- |
| GET `/api/v1/app-market` | 已发布目录、当前安装及操作状态 |
| POST `/api/v1/app-market/:id/operations` | install/update/uninstall；Idempotency-Key 必填，接受版本及权限 |
| GET `/api/v1/app-market/operations/:id` | 查询自己的操作回执 |
| GET `/api/v1/applications/:id/runtime?platform=web` | 受授权的运行描述；也支持 android/ios |
| POST `/api/v1/applications/:id/invoke` | 校验 releaseId、generation、method 权限后调用绑定后端 |
| GET/PUT `/api/v1/desktop/:device` | 只包含当前已安装应用，目录摘要与排序版本冲突检查 |

## 开发与正式部署

首次运行：`pnpm install && pnpm db:init`。随后 `pnpm dev` 同时运行 API 3000、宿主 5173、后台 5175、计算器 5176、产物服务 6176 和公共包 watch。分别运行时先 `pnpm build:contracts`，再 `pnpm dev:api`、`pnpm dev:app`、`pnpm dev:apps`。移动端 live reload 把本机应用开发地址换成宿主 LAN 地址，设备需要同时能访问 3000/5173/5176 对应服务。

`pnpm build` 或 `pnpm pack` 构建宿主与独立计算器。数学代码不再打进宿主；计算器产物生成到 `output/app-artifacts/calculator/<sha256>/`，附带逐文件摘要。`pnpm serve:apps` 在 loopback 6176 提供按摘要分版本的产物，检查路径与文件摘要，设置 CSP，并保留旧版本。正式环境用独立 HTTPS 来源反向代理这个服务，例如 `apps.example.com`；不能与主站同源。

正式环境设置 `APP_ARTIFACT_ORIGIN=https://apps.example.com`，与产物反向代理来源保持一致。API 与产物服务需要共享持久化的 `output/app-artifacts` 目录。复制 `apps/calculator/deployment.example.json` 为 `deployment.local.json`，填写相同的独立 HTTPS origin 和构建输出的 artifact 摘要，再启动 API。API 验证产物清单摘要，并登记新的不可变 release。第一次初始化预装版本自动上线；同应用后续部署版本只登记为待发布，需管理员发布。已有用户在市场确认更新；不要原地替换已发布文件。默认 localhost 发布定义仅用于开发，`NODE_ENV=production` 必须提供正式部署配置。

Capacitor 仍把宿主 dist 复制到 www。独立应用通过受约束容器运行；生产不使用 `server.url` 接管壳，也不自动暴露 Capacitor 插件。计算器本地历史通过有权限校验的宿主存储桥保留，旧宿主记录会按当前用户迁移，原记录不删除。安装状态不是离线缓存，当前独立应用需要网络加载。正式 Android/iOS 打包需要可访问的 HTTPS API 与应用产物地址；本阶段未作真机发行验证，也未接入外部第三方应用商店发行。

## 验证

`pnpm typecheck`、`pnpm test`、`pnpm test:ui-components`、`pnpm test:desktop`、`pnpm test:app-platform`。平台集成使用真实 MySQL 和独立 HTTP 服务故障夹具，验证权限、账户隔离、幂等重复、远程响应丢失、重启恢复、更新增权、旧版本拒绝与卸载撤权；夹具远程回执仅用于测试，不是生产远程服务实现。

## 后台提交、发布与更新

后台 `http://localhost:5175/#/applications` 新增“应用发布”。每个应用有独立版本号；格式为 `1.0.0` 或 `1.0.0-beta.1`，同应用不能重复创建同一版本。

1. 添加应用或选择已有应用“新增版本”。类型在创建时确定，后续版本不能改变。
2. 独立 Web 应用上传构建后的 dist 目录（最多 2000 文件，总计 20 MB，单文件 5 MB），也可选择脚本已生成的产物。资源必须使用相对路径，入口使用应用 SDK。后台计算摘要，文件以摘要分目录保存，拒绝路径穿越、重复文件和非规范编码；不执行安装脚本。
3. 保存草稿，可以继续编辑。草稿修订号防止互相覆盖。已有应用继承可信部署的后端绑定、权限、工具和技能，表单不能提交任意后端地址或修改工具契约。新增纯 Web 应用可直接发布；新增后端/AI 能力需要先部署对应 SDK 模块。
4. 提交后定义锁定，仍不向用户市场提供。提交和发布都会验证完整文件摘要，以及当前工作进程是否部署了后端。
5. 确认发布后成为线上版本；原线上版本变为历史版本。检查期望的线上 releaseId，避免并发覆盖。切换历史版本也经过同样校验与确认，并记录管理员审计。
6. 发布不会改写已安装用户的版本；用户在应用市场确认更新。发布变化通过数据库指纹被各 API 工作进程识别，新系统应用会为已有用户自动预装。

内置页面的应用不能靠填写版本号完成实际升级：新版本需先部署相应版本的宿主与 API。操作接口还检查客户端携带的已编译应用版本，客户端过旧时提示刷新网页或升级宿主。当前设置、应用市场仍随宿主发布；计算器、日历、记账与时间已支持通过各自的独立 Web 产物更新。

后台接口均在管理员会话及 CSRF 校验下：

- GET `/api/v1/admin/applications`：应用、版本状态、就绪检查、产物来源。
- GET/POST `/api/v1/admin/applications/:id/artifacts`：查询/上传静态构建产物。
- POST `/api/v1/admin/application-releases`：创建应用的版本草稿。
- PATCH `/api/v1/admin/application-releases/:id`：带 revision 修改草稿。
- PATCH `/api/v1/admin/application-releases/:id/metadata`：带 revision 修改待发布版本的更新说明与提示，版本号及构建保持锁定。
- POST `/api/v1/admin/application-releases/:id/transitions`：submit / publish，带 revision 和 expectedCurrentReleaseId。
- GET `/api/v1/admin/applications/:id/events`：管理员操作记录。

新增验证：`pnpm test:app-publishing`。真实管理员会话、MySQL 和静态文件夹具验证草稿隔离、提交锁定、产物篡改、版本冲突、发布冲突、版本固定、历史切换、审计及跨工作进程预装；只清理测试自身生成的应用和账号。
