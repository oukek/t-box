# 应用接入契约 1.0

解耦的目标是：应用通过稳定契约接入宿主，领域服务与 REST API 不依赖 AI。AI 负责模型调用、工具循环、技能启用、委派和持久任务；应用负责参数校验、权限、事务、业务规则以及 UI。原领域模块仍是同仓库的逻辑模块；新的独立 Web 容器、后端服务适配、安装与发布协议见 [应用平台](application-platform.md)。系统/用户分类与 shell/web 运行方式分开管理。

## 边界

- `packages/app-contracts/src/capabilities.ts`：协议版本、提供商 SDK 无关的工具定义、前端交互声明、公开能力目录 DTO。
- `api/src/application-sdk/`：应用模块、工具上下文、资源授权、技能、Agent、导航及 schema 辅助函数。这里不引入 AI 运行层、OpenAI 或数据库实现。
- `apps/<app>/server/src/`：应用自己注册工具与处理器、技能、Agent、访问适配器和导航。只注入自身所需领域服务；例如记账只需要 access、finance、statistics，不再接受整个 PlatformService 的类型。
- `api/src/bootstrap/application-adapter.ts`：把运行上下文转换成受限应用上下文，再调用应用处理器。应用不能获得 registry、journal、模型 history、运输 token、完整消息内容；只能获得当前身份、资源绑定、请求 ID、取消信号、通用客户端交互、任务内缓存及附件视图。
- `api/src/applications/registry.ts` / `app/src/applications/registry.ts`：前后端的静态组装入口。添加应用在这里注册，AI 核心、对话首页和通用工具执行器不添加应用业务分支。

这不是不可信代码隔离：应用代码仍是经过审核的第一方代码。SDK 限制依赖与上下文，不替代领域服务的权限和安全检查；需要运行外部插件时应另做进程隔离与认证适配。

## 模块声明

新后端模块必须声明 `contractVersion: APPLICATION_CONTRACT_VERSION`、唯一 `id`、`skills`、`tools`；拥有页面的模块另提供 `manifest` 与 `navigation`。工具名称保持全局唯一，新应用使用自身前缀。现有账本工具名称保留，避免破坏历史任务。

每个工具必须声明：名称/说明/input schema、标题、执行位置 `server | client`、副作用 `read | write | external | ui | configuration`、成功摘要。后端工具提供 handler，前端工具提供参数规范化；写入和外部副作用提供 writeFingerprint。应用可声明 resources、confirm、validate、attachments。schema 只描述输入，真实参数校验仍在处理器和领域服务执行，不能依赖模型遵守说明。

工具还可声明公开输出占位 `preview: {kind: "image", width, height, label}`。该元数据只用于宿主显示进度，不进入模型参数；校验/授权通过并正式派发时才通知前端，拒绝调用、复用旧回执不会启动新的占位动画。成功资源通过原有 `attachments` 回调提取，并随工具完成事件立即交付前端。应用负责声明，通用执行器负责通知，AI 核心不识别图片工具名称。

`handler(value, context)` 使用 SDK 的 `ApplicationToolContext`。UI 与 AI 工具调用同一领域服务，不重复实现余额计算、收还款、权限或事务。认证身份来自 context.actor，不能相信模型提供的 userId。服务端授权和资源校验是最终依据，模型选择应用、公开目录以及前端 ACK 都不授予权限。

技能只能引用本模块工具；manifest 的 skillIds、专业 Agent 的 skillIds 只能引用本模块技能。跨应用协作由主助手协调或委派，不能通过跨模块技能引用扩大权限。注册时拒绝重复工具/技能/交互、缺失处理器、无去重指纹的副作用、错误资源适配器所属应用和不支持的协议版本。

## 前端交互

`interactions` 与前端 clientTools 的处理器一一对应，是共享声明，不是第二份模型工具列表。记账的 `application_authorize` 和 `finance_confirm` 分别处理账本密码授权和财务确认；密码直接发给应用认证 API，工具参数与模型上下文不包含密码。后端拿到 ACK 后重新检查可信授权，用户确认不能伪造权限。

前端模块声明协议版本、manifest、页面、导航与安装类型。系统模块可额外声明仅含 name/description/icon 的 `presentation`，由宿主在桌面、应用标题和市场中统一展示；例如 profile 的宿主名称改为设置。它不修改已发布的不可变 manifest、应用 ID、安装版本、校验哈希或后台版本历史；用户应用不能借此覆盖系统展示。`ai` 是可选适配器：只有接入 AI 的模块在这里声明 clientTools、interactions、资源 bindings、authorize 和 cancelInteractions；纯桌面应用不需要实现这些方法。桌面可信目录单独位于 `shared/src/desktop.ts`，不会用 AI registry 充当安装目录。入口仅打开预先注册的页面，模型不能指定 URL、下载脚本或动态导入任意模块。前后端交互说明可放在 `apps/<app>/contracts/src/`，运行时校验声明和处理器匹配。

服务端工具不依赖页面保持打开。需要用户处理的交互必须放在 `resources`、`confirm` 等派发副作用之前的边界：无前端时暂停，检查点保留该调用，重连后重新交互并重新验证权限。已派发且回执不确定的写入／外部调用仍需人工核对，不能自动重试。

提交业务后仅用于本机同步的交互可传 `optional: true`，例如通知同步；离线时返回 `CLIENT_SYNC_DEFERRED`，不把未同步谎报为成功，也不阻塞后台任务。可选交互不得用于授权或确认。不要在已经提交副作用的 handler 中加入必须确认的交互，否则无法安全重放中途的函数调用。

## 能力目录

登录用户可读取 `GET /api/v1/applications` 和 `GET /api/v1/applications/:id/capabilities`。返回值从当前 AI 使用的同一个 CapabilityRegistry 生成，包括实际工具 schema、执行位置、副作用、资源校验/确认/去重声明、技能、Agent 和前端交互。返回独立副本，不包含 handler、运行指令、密码、用户资源、模型或服务商配置。查看目录不会启用技能、执行工具或收费。

前端「OS → 整理 → 应用信息 → 查看工具与技能」展示该目录，并标注当前客户端是否支持声明的前端交互。支持列表只表示客户端实现存在，不能视为用户授权；实际调用仍受 clientCapabilities 白名单、服务端校验和任务状态约束。协议版本不兼容时详情页拒绝展示，提供重新加载提示。

新持久任务记录已使用模块的能力摘要和安装授权版本；旧任务兼容保留全局 revision 检查。改变执行语义应同时更新应用/技能与不可变发布版本。

## 新应用接入

1. 实现自身领域服务和 REST API，并提供需要注入的最小服务接口。
2. 用 application-sdk 定义工具、技能、可选 Agent、导航和资源授权适配器。
3. 声明共享 manifest，实现页面并在桌面目录与前端 registry 注册。需要 AI 时再声明前端 `ai` 适配器、共享交互契约与 clientTools；不需要 AI 时跳过后端能力模块与适配器。
4. 需要 AI 的应用在前后端 application registry 注册。运行层通过 adaptApplication 注入上下文，能力详情自动从后端注册生成，无需修改 AI 循环或手写展示工具列表。
5. 用假的模型验证读写、权限撤销、取消/断线、重复调用、确认回执、资源历史保护及目录不执行工具。用架构测试防止应用重新导入 agent/chat/OpenAI。

独立 Web 应用、HTTP 独立后端适配、应用安装授权与生命周期队列已落地，参见 [独立应用平台](application-platform.md)。MCP、自助发布审核、远程交互续办和外部技能包尚未实现。不能让模型任意选择远程地址或注册可执行代码。
