# T方舟 · T Ark

中文名称为 **T方舟**，英文名称为 **T Ark**。网页关于页展示两者；原生应用在中文系统显示「T方舟」，其他语言系统显示「T Ark」。包名、Bundle ID、数据库名和链接协议沿用现有技术标识。

一个 pnpm workspace：同一套 Vue 页面用于 PC、手机浏览器及 Capacitor iOS / Android 应用。所有页面组件自行实现，不依赖第三方 UI 库。

```text
t-box/
├── app/          Vue 3 + TypeScript + Vite，AI / OS 宿主外壳
├── capacitor/    Capacitor 壳，与 app 同级
│   ├── www/      从 app/dist 复制的网页资源（生成目录，不提交）
│   ├── ios/      Xcode / CocoaPods 工程
│   └── android/  Android Studio / Gradle 工程
├── capacitor-plugins/  独立原生插件 workspace（含扫码插件）
├── admin/        独立 Vue 3 管理后台，服务商、模型与管理员
├── api/          Node.js + TypeScript + Fastify + TypeORM，REST 与对话 WebSocket
├── apps/         独立应用 workspace：记账、计算器、日历、时间、设置、市场及图片工具
├── packages/     应用 SDK、自有 UI、设备通知及服务基础包
├── shared/       宿主 DTO、对话协议与应用类型兼容导出
└── scripts/      原生同步及开发调试脚本
```

应用源码、公共包与宿主职责见 [应用目录与边界](docs/apps-layout.md)，应用接入方式见 [统一应用 SDK](docs/application-sdk.md)。计算器、记账、日历、时间使用独立 Web 产物；设置和市场随宿主构建。首次上线按 [OSS 前端与 PM2 后端操作顺序](docs/first-deployment.md) 配置。

## 本地启动

使用 Node.js 24.15+、pnpm 11.18.0。先启动 MySQL；Redis 可选，本机已配置 Redis 时也应保持运行。

**日常开发只需在项目根目录运行：**

```bash
pnpm dev
```

启动器检查依赖、构建 Node 依赖与应用声明，然后先启动 API，健康检查通过后再启动主站、管理后台、全部独立应用和应用资源服务。看到「API 就绪」和 Vite 地址后打开页面。终端保持运行，按 Ctrl+C 一起停止；不要另外重复启动同一套服务。

**只有首次使用全新空数据库时**才执行以下初始化步骤：

```bash
pnpm install
# 首次拉取项目需要复制 api/.env.example 为 api/.env 并填写连接信息。
# 当前工作目录已有 api/.env，不需要覆盖。
pnpm db:init
pnpm admin:init    # 首次创建管理员，已有账号时不重置
pnpm user:init     # 可选：创建首个普通账号及个人账本，已有用户时不修改
pnpm dev
```

- 前端：<http://127.0.0.1:5173>，Vite 同时监听局域网地址。
- 管理后台：<http://127.0.0.1:5175>，独立构建与部署。
- API：<http://127.0.0.1:3000/api/v1>，默认仅监听本机。
- 健康检查：<http://127.0.0.1:3000/api/v1/health>。

`pnpm dev` 包含全部子应用的 Vite HMR；API 使用一个源码监听器直接加载 workspace 源码，避免多个编译器同时改写 dist 导致反复重启。前端 `/api` 请求由 Vite 转发到本机 API，因此手机调试无需直接访问 API 端口。子应用端口 5176–5181 是宿主内部使用的入口，请通过主站 OS 桌面打开应用。

单独启动后端，在项目根目录运行 `pnpm dev:api`；前端和管理后台分别用 `pnpm dev:app`、`pnpm dev:admin`。拆开启动时还需按用途运行 `pnpm dev:apps` 和 `pnpm serve:apps`；通常直接使用 `pnpm dev` 即可，不需要另开 `pnpm dev:packages`。

`db:init` 创建不存在的数据库并执行当前完整初始化，重复运行不修改数据或配置，不插入演示账单。旧开发库或旧迁移失败留下的库不能直接接管，请改用新库；不会自动清空原库。详见 [数据库初始化](docs/database-initialization.md)。数据库密码只保存在 `api/.env`，该文件已经加入 `.gitignore`；前端环境变量中不要放数据库连接信息。

**当前额度体系使用新基线 `2026-10-23.2`，旧开发库不能直接使用。请配置新的 `MYSQL_DATABASE` 后初始化，原库保留。** 不实现旧余额兼容，见 [资源包实施规格](docs/ai-resource-pack-implementation.md) 与 [数据库初始化](docs/database-initialization.md)。

本地配置 MySQL 和可选 Redis，使用 [api/.env.example](api/.env.example)；生产还需在 PM2 服务器填写业务文件 OSS AccessKey，地域和 Bucket 由 Actions 自动写入发布包。用户文件、AI 图片、记账附件及分类图标统一存 `tboxos/uploads/resources/`，数据库只保存相对路径。上传对象使用独立的 256 位随机名称；宝宝日记附件共用该桶的 `uploads/resources/application-files/`，保留对象级私有权限，无需新增桶。网站发布凭据和应用导入 Token 在 GitHub 配置，微信支付与 AI 密钥在后台填写。普通 API 跨域默认开放，生产后台限定管理来源；全部配置见 [API 环境配置](docs/api-environment.md)，生产按 [首次部署步骤](docs/first-deployment.md) 操作。

OSS 文件均公开读，前端拼接 OSS 域名和相对路径直接访问，不申请下载签名；资源列表、上传、删除和账本接口仍需登录。拿到公开链接即可读取对应图片或附件。生产不保存业务文件或应用静态副本，临时下载 / 解压 / 备份用完清理；服务器仅保留后端程序、运行配置、密钥和必要日志。

## 首页、应用与记账

底部两个入口：**AI** 保留会话窗口，顶部「AI 中心」侧栏提供余额、AI 费用说明、我的资源和任务记录；**OS** 是手机桌面式的应用入口。打开应用及详情页面后隐藏底部导航。「设置」（保留原 profile 应用 ID）提供个人账号、安全、当前设备的使用偏好和关于/版本信息。修改密码与退出登录放在账号信息内，退出前需要确认。长按图标或点击「整理」可拖动排序，后端按账号分别保存移动端和 PC 桌面；也支持方向键及按钮移动。记账为可卸载用户应用，其他现有应用为可升级、不可卸载的系统应用；应用不必提供 AI 工具。版本号从 `app/package.json` 读取。详细接口与扩展说明见 [OS 桌面](docs/desktop.md)。应用安装后的网页/原生本地资源、后台预取、校验与失败回退见 [应用资源架构](docs/application-local-resources.md)。

未配置并启用普通会话模型时，首页提示尚未接入 AI，不识别文本、不调用工具、不自动记账。后端已经拆分模型适配、技能注册、工具注册与多轮调度；前端工具通过 WebSocket 执行并回传结果。任务状态、执行检查点和工具结果已入 MySQL；主助手可委派具有独立上下文与工具范围的专业 Agent，断线后可从任务记录继续。实现与恢复边界见 [持久任务与专业 Agent](docs/tasks-and-agents.md)。首次会话支持自动标题及手动改名，公开思考摘要、分析与工具按时间线显示，完成后自动折叠过程，见 [会话展示与通讯协议](docs/conversation-presentation.md)。详细边界、调用时序、扩展方法和当前持久化范围见 [架构说明](docs/architecture.md)。

AI 中心提供可管理的跨会话记忆，自动整理默认关闭；候选确认后才会用于对话，会话也可单独关闭记忆。工作状态随任务检查点保存，应用数据与权限仍归应用管理。配置、费用与升级见 [AI 记忆](docs/ai-memory.md)。

单位换算也是默认安装、不可卸载的系统应用，支持 35 类、314 个单位、常用换算和历史记录；页面在本地即时换算，前后端共用同一纯计算引擎；查询目录、单项及批量换算均提供后端 AI 工具。使用与扩展见 [单位换算应用](apps/converter/README.md)。

## 账本与统计

普通账号登录后，可以创建日常、往来、综合账本，也可以通过邀请加入共享账本。每个账本独立分类、成员权限和密码；共享成员访问同一份数据。初始普通账号为 `tbox`，随机密码保存在本机 `api/.secrets/bootstrap-user.txt`。进入应用后可点击顶部昵称修改账号密码；新注册账号拥有自己的日常账本，不会获得原有账单。

收支支持新增、修改、删除、分类、搜索及分页。往来支持应收/应付、部分收款/还款、一次关联多笔、撤销误记，实时更新剩余金额。每个账本有日、月、季度、年的普通收支、资金流、分类和事件明细统计，往来账本额外展示期初、期末及当前剩余应收/应付。借还本金不混入普通收支。

统计采用事务内同步的日汇总投影，月/季度/年聚合日汇总，可从原始事件重建；Redis 不作为余额来源。财务写入有持久化幂等键和账本行锁，避免网络重试或共享并发还款重复扣减。金额保持十进制字符串和 MySQL DECIMAL，按分使用 bigint 运算。

首页不展示账本选择器。对话中的财务工具沿用记账应用最近选中的账本，首次使用选择账号现有的默认账本。普通聊天不依赖账本解锁；没有可访问的目标账本时，后端拒绝财务工具操作，并提示先从应用页打开、解锁账本，不能自动切到其他账本或访问旧的无作用域仓库。切换目标账本会隔离模型的工具上下文。AI 往来写入会在前端展示并等待确认。共享更新通过单独账本 WebSocket 通知刷新。数据模型、统计口径、权限、密码及接口详见 [账本与统计架构](docs/ledgers.md)。

## 管理服务商、模型与管理员

打开 <http://localhost:5175>。初始用户名为 `admin`，随机密码保存在本机 `api/.secrets/bootstrap-admin.txt`（仅当前系统用户可读）；首次登录后可以在“管理员”页面修改密码，然后删除该初始凭据文件。`pnpm admin:init` 不会重置已有管理员。

1. 在“服务商”页面新增名称、Base URL（通常以 `/v1` 结尾）和 API Key。
2. 在“模型”页面添加模型，选择服务商后，**后端**使用该服务商的凭据调用 `/models`，前端从返回列表中选择模型标识，并设置独立显示名称。
3. 选择模型的调用方式（Responses 或 Chat Completions），可点击“测试”验证对应接口的流式响应与工具调用；这会发送一次小型模型请求。
4. 在“当前对话配置”中选择模型并应用。下一个对话请求生效，无需重启 API；选择“未启用会话模型”即可停止使用 AI。

服务商、模型和当前选择分别存入 MySQL 的 `ai_providers`、`ai_models`、`ai_settings`。不再通过 `AI_PROVIDER` 或 `OPENAI_*` 环境变量配置模型。模型列表可见不代表支持工具调用：普通会话支持 **Responses 或 Chat Completions、流式响应、function calling**。调用方式保存在模型配置中，下一轮任务生效；图片模型固定使用独立 Images API，不与会话模型混用。Chat Completions 使用事实摘要压缩和保守上下文估算，实际计费仍来自服务商 usage。

最小接口排查：`pnpm --filter @t-box/api test:model-smoke` 使用当前数据库配置的会话模型，分别直接请求 Responses 和 Chat Completions，只问「1+1=多少」，不携带历史、工具或系统 Prompt。`pnpm --filter @t-box/api test:model-smoke responses_stream` 单独检查 Responses 流式接口。输出 HTTP 状态、答案、耗时和请求 ID，不输出密钥。这是手动真实请求，不进入普通单元测试，也不修改模型选择或写入应用数据。

验证实际会话入口：`pnpm --filter @t-box/api test:chat-routing all` 用真实模型分别检查两种接口的「1+1」直接回复，断言只调用一次正文模型、没有分析计划时间线。使用临时账号，结束后清理；不修改模型选择。此手动测试会请求服务商，不进入普通单元测试。

图片流程验证：`pnpm --filter @t-box/api test:image-workflow` 检查真实任务/资源存储、成功回执直接交付及服务重启后不重复生图。`test:image-workflow-live` 使用当前真实会话模型验证规划和工具调用，图片输出使用本地测试资源，不请求图片模型；会话请求可能由服务商收费，测试账号和资源自动清理。

`admin_users` 保存管理员与 scrypt 密码摘要，`admin_sessions` 保存会话令牌摘要。后台支持创建、启停管理员及修改自己的密码；修改密码、停用账号会撤销其已有会话。管理接口使用 HttpOnly Cookie、SameSite 与请求头校验，不向前端返回已保存的服务商密钥。

服务商密钥以 AES-256-GCM 加密后入库。加密主密钥自动生成在 `api/.secrets/provider.key`，它不属于模型业务配置，也不能与密文一起存入数据库。**迁移或备份时需同时保留数据库与此文件**，遗失后需要重新填写服务商密钥；多实例需共享同一主密钥。`.secrets/` 已忽略，开发服务器也拒绝读取其中的文件。

后台详细分层及接口见 [管理后台架构](docs/admin.md)。

后台“配置中心”管理平台 AI Prompt、执行与重试策略、模型请求参数。配置入库并使用 Redis 版本缓存，支持发布历史与恢复；缓存故障回退 MySQL。应用自身设置和其 Agent / Skill / 工具契约由应用维护，后台不覆盖。范围与生效规则见 [配置中心与 Redis](docs/configuration-center.md)。

对话历史、工具回执与请求去重记录保存于 MySQL；连接和运行任务保存在 API 进程内存。API 重启或连接过期后，已登录用户按历史会话 ID 自动恢复；尚未发送消息的空对话自动建立新连接。开发热更新会重新初始化连接。前端断线后后端继续执行；需要前端操作时暂停，重新打开所属对话后自动恢复交互。服务重启或模型错误暂停的任务需主动继续，断线前的消息不会自动重发；已经写入的账单仍然保留。受保护历史恢复时仍需有效的账本权限与密码授权。

计算器、日历和时间的本地计算范围，以及 workspace 包导入错误的处理方式，见 [本地计算与开发启动](docs/local-execution-and-development.md)。根目录 `pnpm dev` 会先校验安装并补齐工作区链接；前端开发和构建统一直接解析工作区源码。

## H5 / PC 构建

所有 workspace 共用根目录 `eslint.config.mjs`：TypeScript / JavaScript 使用单引号、无行尾分号、两空格缩进，每条声明只定义一个变量，分支使用展开的大括号。Vue 模板、CSS / HTML 和配置文件也通过同一入口检查；Swift / Java 等原生源码由对应原生工具链处理。无分号风格仍保留避免自动分号插入歧义所需的行首分号。

在根目录运行 `pnpm lint` 检查整个项目，`pnpm lint:fix` 自动修复，`pnpm check` 同时检查应用边界和类型，`pnpm test:unit` 运行 API、前端、SDK 和原生脚本测试。可以用 `pnpm exec eslint apps/ledger --fix` 仅整理某个子应用。测试继续使用 `node:test`，ESLint 不修改 pnpm 安装策略。VS Code 的项目设置提供 ESLint 保存修复，CSS / HTML 的 Prettier 格式化由 ESLint 统一调用。

Actions 的“代码规范检查”（`.github/workflows/quality.yml`）仅运行 `pnpm lint`，不构建项目、不启动数据库、不运行业务或浏览器测试。发布工作流独立运行，不要求先通过该检查，也不运行回归测试。类型检查、单元测试和需要本地 MySQL 的集成测试仍可按下列命令按需运行。

```bash
pnpm run pack        # 前端 → app/dist
pnpm build           # 构建 API、应用和独立管理后台
pnpm typecheck
pnpm test
pnpm test:admin      # 本地 MySQL 集成测试，临时配置与账号会清理
pnpm test:categories # TypeORM 账单、分类与工具链集成测试
pnpm test:ledgers    # 共享账本、统计重建、权限与并发结算
pnpm test:consent    # AI 往来确认流程，使用本地假模型
pnpm test:presentation # 真实数据库标题生成、改名保护及时间线持久化
pnpm test:tasks      # 真实数据库任务恢复、租约、写入去重与专业 Agent 检查点
pnpm --filter @t-box/api test:task-concurrency # 24 个新会话并发与写入去重
pnpm --filter @t-box/api test:model-retry # 流式故障、断点重试、专业 Agent、倒计时去重和用量审计
pnpm test:chat       # 隔离测试服务的真实 WebSocket 集成测试
```

请使用 **`pnpm run pack`**；`pnpm pack` 是 pnpm 自带的 npm 包压缩命令。

生产使用 [OSS 网站与 PM2 后端](docs/first-deployment.md)：GitHub 普通变量只填 `DEPLOY_DOMAIN`、`OSS_REGION`，主站直接使用 `https://<DEPLOY_DOMAIN>`（当前为 `https://tboxos.cn`），后台、子应用和 API 分别使用 `admin/apps/api` 子域名；站点地址、三个 Bucket 和发布目录由 `deploy/settings.mjs` 统一生成。**前端与后台部署（OSS）** 发布主前端和后台，构建时写入生成的 API 地址；普通 API 跨域默认开放，后台限定管理域名并通过跨来源 Cookie 和管理请求头登录，后台与 API 使用同一主域名下的 HTTPS 子域名。**后端部署（PM2）** 先将当前包内全部独立子应用静态种子（含宝宝日记）上传 OSS，再上传、初始化数据库并启动 API 和恢复 worker（APP_ARTIFACT_DELIVERY=oss）。**子应用发布（OSS）** 发布子应用静态版本并提交后台审核。全部 Actions 手动触发，首次配置、GitHub Secrets 和微信设置按操作手册执行。PM2 细节见 [后端发布](docs/api-pm2-deployment.md)，可选 Docker 方案见 [镜像部署](docs/api-docker-deployment.md)。

## iOS / Android 开发热更新

先在一个终端保持运行：

```bash
pnpm dev
```

再在另一个终端运行：

```bash
pnpm native:dev:ios
# 或
pnpm native:dev:android
```

脚本选择本机局域网 IPv4，将开发地址同步到对应原生项目，然后打开 Xcode / Android Studio。在 IDE 中选择设备或模拟器并运行。真机与电脑需要处于同一局域网；修改 Vue / CSS 后即可通过 Vite HMR 更新。

多网卡、VPN 或模拟器场景可以手动指定：

```bash
pnpm native:dev:ios --url http://192.168.1.10:5173
pnpm native:dev:android --url http://192.168.1.10:5173
# Android 官方模拟器访问宿主机时也可使用：
pnpm native:dev:android --url http://10.0.2.2:5173
# 配好 SDK / 设备后，也可让 Capacitor CLI 直接运行：
pnpm native:dev:ios --run
```

开发热更新采用 Capacitor 的 [Live Reload](https://capacitorjs.com/docs/guides/live-reload) 配置。只有开发命令会设置 `server.url`；`native:sync` 和正式打开命令都会重新构建并清除开发地址。这是本地开发调试机制，不包含线上 OTA 更新服务。

## 使用内置网页资源打包

原生应用不能通过相对路径 `/api/v1` 找到你的电脑。请先在 `app/.env.production.local` 配置设备可访问的 **HTTPS API 地址**，例如：

```dotenv
VITE_API_BASE_URL=https://api.example.com/api/v1
```

然后：

```bash
pnpm native:sync       # 重新构建前端并同步两个原生工程
pnpm native:ios        # 重新构建 / 同步，再打开 Xcode
pnpm native:android    # 重新构建 / 同步，再打开 Android Studio
```

未配置地址时，浏览器构建继续使用同源 `/api/v1`；原生内置资源模式会显示配置提示，避免把请求误发到 WebView 本地服务器。开发热更新模式通过 Vite 代理访问 API，不需要此生产配置。

原生构建链路和版本规则见 [Capacitor 说明](capacitor/README.md)。`capacitor/package.json` 的 `version` 自动同步到两端；通过 `APP_BUILD_NUMBER` 指定构建号，未指定时保留现有构建号。

当前应用标识为 `com.tbox.app`，名称为 `T方舟`。iOS 使用 Xcode 的 Archive / Signing & Capabilities 配置签名，Android 使用 Android Studio 的 Build / Generate Signed Bundle or APK 配置发布签名。发布前请同时调整 Capacitor 配置及已生成原生工程中的 Bundle Identifier / applicationId。

项目最低支持 iOS 15.4（使用原生 HTML dialog）及 Android API 24，Android System WebView 需保持更新。开发工具使用 Xcode 26+、CocoaPods 1.16+、Android Studio Otter 2025.2.1+；本机 Android Studio GUI 版本较旧，但已经使用其自带 JBR 21 成功完成 Gradle CLI 构建。

iOS 使用 CocoaPods 从源码编译 Capacitor，打开 `capacitor/ios/App/App.xcworkspace`。本机 iOS 27 模拟器对照测试中，Capacitor 8.5.2 的 SPM 预编译分发会在启动时停留空白页，源码构建正常；因此项目采用 CocoaPods，没有保留临时脚本兼容补丁。`native:sync` 会自动执行所需的 `pod install`。

原生环境要求见 [Capacitor 官方环境说明](https://capacitorjs.com/docs/getting-started/environment-setup)。本机若默认 Java 不可用，可以仅对构建命令指定 Android Studio 自带的 JBR：

```bash
cd capacitor/android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew assembleDebug
```

## REST API 与数据访问

统一前缀 `/api/v1`。普通用户使用 `/auth` 登录，账本相关接口都位于 `/ledgers/:id/...`，要求 Bearer 身份。旧无归属的 `/bills`、`/categories` 已从生产 API 关闭。完整接口及参数见 [账本与统计架构](docs/ledgers.md)。

普通响应为 `{ "data": ... }`，分页另含 `meta`；错误为 `{ "error": { "code": "...", "message": "..." } }`。财务写入需 `Idempotency-Key`，同键同参数返回原结果，同键不同参数返回 409。密码锁未解锁返回 423，非成员访问返回 404。

数据库使用 TypeORM DataSource、EntitySchema、Repository 和显式建表初始化。历史 migrations 已合并为当前完整基线；`pnpm db:init` 通过 `schema_initialization` 记录初始化状态；`synchronize` 始终关闭。首次正式部署后保留基线，后续结构变化使用增量升级脚本。普通增删改查、筛选分页和事务行锁使用 Repository / QueryBuilder；复杂财务投影、关联更新及数据库命名锁保留参数化 SQL，通过同一 TypeORM 事务 EntityManager / QueryRunner 执行。`mysql2` 是 TypeORM 驱动，另仅用于创建尚不存在的数据库。

`api` / `shared` 采用原生 ESM + TypeScript NodeNext，`.ts` 源码相对导入写 `.js` 对应编译产物的扩展名，生产由 `node dist/server.js` 运行。若省略后缀，需要增加构建打包或模块解析重写；仅改 TypeScript 解析选项不会让 Node 支持无后缀相对导入。

API 默认监听 `127.0.0.1`，HTTP 和 WebSocket 来源默认开放，后台回显来源以支持 Cookie；仅需限制来源时再设置高级选项。公开部署使用 HTTPS/WSS。多实例部署还需共享对话会话、限流和账本通知，财务数据、幂等结果和 AI 任务/工具日志已在 MySQL 持久化，任务具备数据库租约和会话版本保护；这不替代其他服务的跨实例通知与限流。

图片会话、独立图片模型、历史、资源管理与 10 分钟账本授权的实现和接口见 [会话与资源架构](docs/conversations-resources.md)。后台「模型」分别选择普通会话与图片工具模型；普通模型需勾选看图能力。未配置真实模型时直接提示尚未接入 AI；附件仍可上传和保管，不进行本地识别或生成。新增链路可通过 `pnpm test:media` 验证，不产生真实模型调用费用。

资源包、额度与支付见 [计费与支付架构](docs/billing-and-payments.md)。后台「模型」管理采购成本，「资源包与费率」管理用户额度价格和商品版本，「用户与额度」设置免费用户与赠送。用户在「AI → AI 中心 → 我的额度」查看资源包、到期和使用明细。初始公开文本费率未启用，须确认并发布；标题、记忆整理、自动上下文压缩由平台承担。免费用户完整记录但不预占、不扣额度。微信支付通过商品版本快照发放资源包，需配置商户信息后开放；`pnpm test:billing` 不产生真实费用。

失败任务不会锁死输入框，可直接发送新消息结束旧暂停任务。修改重发创建新分支并保留原对话；删除前确认问题和回答一起删除，应用业务记录不撤销。协议与恢复边界见 [消息修改与删除](docs/chat-messages.md)。

会话 token 明细、socket 用量和上下文压缩见 [上下文与用量](docs/ai-context-and-usage.md)。后台每个模型单独配置输入/输出预算、总窗口、事实摘要/原生压缩方式与兼容能力。默认 75% 触发、保留最近四轮，支持执行中整理并纳入时间线。策略见 [会话历史与上下文整理](docs/chat-context.md)。缓存、推理用量不重复计入总数，压缩按真实消耗记录费用，标题生成继续免费。

微信 iOS / Android 原生 APP 支付的配置与真机联调见 [接入说明](docs/wechat-native-payments.md)。

日历与时间应用的功能、日期口径、提醒边界、REST / AI 工具及验证方式见 [日历与时间](docs/calendar-time.md)。

## 独立应用与市场

独立应用支持手动 GitHub Actions 构建、上传到公开应用 Bucket `tboxos-app`、自动登记为已提交版本，管理员再手动上架。运行 `pnpm apps:workflow` 扫描 `apps/*/build.config.json` 并更新 Actions 应用下拉选项；生成结果需要提交到 Git。服务器配置、导入凭证与操作步骤见 [应用 Actions 发布](docs/application-actions-release.md)。

计算器、记账、日历、时间（各自的 `apps/*` 目录）支持独立 Web 容器、安装与 Actions 发布。记账是可卸载的用户应用，其余现有应用为可升级、不可卸载的系统应用。后台“应用发布”支持构建目录上传、版本草稿、提交、发布与历史版本切换。`pnpm dev` 同时启动计算器（5176）、记账（5177）、日历（5178）、时间（5179）和静态产物服务（6176）；单独启动宿主时也要运行 `pnpm dev:apps`。首次拉取结构变更执行 `pnpm install && pnpm db:init`。详见 [独立应用平台](docs/application-platform.md)及[安装与故障隔离](docs/application-installation-health.md)。

图标源文件、版本图片与后台上传：[应用图标与独立日历、时间](docs/application-icons.md)。

网页与原生均支持游客使用计算器、单位换算、月历/农历、世界时钟等本地功能，云端数据、AI 和记账再要求登录。正式网页首次在线保存完整资源后支持断网刷新；Vite 开发模式仍依赖开发服务。游客版本声明、发布前置条件及缓存/权限边界见 [应用本地资源](docs/application-local-resources.md)。

节假日同步、年度管理与缓存：[日历节假日数据](docs/calendar-holidays.md)。

## 运行与验收基线

本轮完善及验收范围见 [平台完善清单](docs/platform-hardening.md)。后端开发启动使用 `pnpm dev:api`；生产通过统一 PM2 发布入口预检、初始化数据库并启动 API 和独立恢复 worker；应用产物与业务文件使用 OSS。所有工作流保持手动触发，PM2 发布默认在上传后自动启动，也可选择只上传。运行概况、备份和恢复步骤见 [运维手册](docs/operations-and-recovery.md)。

[统一 SDK 与应用脚手架](docs/application-sdk.md)、[成本与并发](docs/ai-cost-controls.md)、[退款与渠道对账](docs/payment-refunds-and-reconciliation.md)、[账号、通知、离线与存储](docs/account-and-offline.md)说明各自的权限、故障与验收边界。

错误工厂、TypeORM 访问边界与自动检查见 [错误与数据访问规范](docs/errors-and-data-access.md)。

### 宝宝日记应用

[宝宝日记](apps/baby-diary/README.md) 是可安装/卸载的独立用户应用，支持多宝宝、成长记录、私有照片、共享权限、创意动画和服务端 AI 工具。已有开发库先按 [数据库增量升级说明](docs/database-initialization.md#宝宝日记增量升级) 执行升级，生产需配置独立私有附件 Bucket。
