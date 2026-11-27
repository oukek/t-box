# T方舟 · T Ark

T方舟是一个跨端应用平台。用户从网页、PWA、Mac 或移动端打开同一个工作台，使用账号、AI 服务和已安装的应用。宿主提供登录、权限、文件和设备能力，管理后台负责平台配置、应用上架和系统版本发布。

## 本地运行

准备 Node.js 24.15 或更高版本、pnpm 11.18.0 和 MySQL。首次拉取项目时，在仓库根目录执行：

```bash
pnpm install
cp -n api/.env.example api/.env
```

在 `api/.env` 填好数据库连接信息。首次使用空开发库时，依次执行 `pnpm db:init` 和 `pnpm admin:init`。已有开发环境直接启动：

```bash
pnpm dev
```

启动器会一起启动 API、主站、管理后台及应用开发服务。打开 [本地主站](http://127.0.0.1:5173) 或 [本地管理后台](http://127.0.0.1:5175)，也可以查看 [API 健康状态](http://127.0.0.1:6868/api/v1/health)。配置说明见 [API 环境变量](docs/api-environment.md) 和 [数据库初始化](docs/database-initialization.md)。

## 部署与发布

**第一次部署**按 [OSS 网站与 PM2 后端部署手册](docs/first-deployment.md) 操作。**网页和 Mac 已在线、准备切换统一发布并首次打 iOS 包**，直接按 [逐步操作单](docs/ios-app-store-release.md) 操作。

本地执行 `pnpm release:ui` 可打开可视化发布工作台，执行 `pnpm release --plan` 可预览本批顺序。配置凭据、并行构建、确认上线和断点续跑见根目录的[更新与发布清单](更新与发布清单.md)。

系统版本在根目录 [release-versions.json](release-versions.json) 修改，随代码提交。GitHub Actions 读取所选提交中的版本。网页、PWA 和 Mac 共用 `ui`，Mac 安装包版本使用 `macos.core`。

| 本次改动 | 运行哪个 GitHub Action | 在哪里生效 |
| --- | --- | --- |
| 主界面 | 主界面构建（网页、PWA、Mac） | 在方舟后台「系统发布 → 主界面」确认一次，网页版本标记和 Mac 签名 UI 同批发布 |
| Mac 核心或首次制作 Mac 安装包 | macOS 整包发布（内置本次界面） | 只升核心时，整包复用已批准的 UI，在「系统发布 → 桌面端」确认。UI 也升版时，在「主界面」统一确认 |
| 平台管理后台 | 管理后台部署 | 工作流部署到后台站点 |
| API 与 worker | 后端部署（PM2） | 按部署手册选择是否启动服务 |
| iOS 安装包 | iOS 发包（App Store） | 可先生成 IPA，再上传 App Store Connect、送审和发布 |
| 独立应用 | 子应用发布（OSS） | 在方舟后台「应用发布」审核上架 |

更多操作见 [Mac 签名与公证](docs/macos-developer-id-signing.md)、[系统更新与版本规则](docs/desktop-system-updates.md)、[生产发布验收](docs/production-system-release-acceptance.md)、[独立应用发布](docs/application-actions-release.md) 和 [运维与恢复](docs/operations-and-recovery.md)。

## 仓库导航

| 目录 | 职责 |
| --- | --- |
| [app](app) | Vue 3 工作台、PWA、应用加载和更新提示 |
| [desktop](desktop) | Tauri 桌面壳、本地资源、签名更新和恢复 |
| [capacitor](capacitor)、[capacitor-plugins](capacitor-plugins) | iOS / Android 工程及原生能力 |
| [admin](admin)、[api](api) | 管理后台、Fastify API、数据存储及后台任务 |
| [apps](apps)、[extensions](extensions) | 独立应用工作区与浏览器扩展 |
| [packages](packages)、[shared](shared) | 应用 SDK、UI 组件、公共协议与类型 |
| [deploy](deploy)、[scripts](scripts) | 部署配置、本地开发及构建工具 |

平台开发从 [系统架构](docs/architecture.md)、[应用目录与职责](docs/apps-layout.md)、[统一应用 SDK](docs/application-sdk.md) 和 [原生端开发](capacitor/README.md) 开始。代码检查使用 `pnpm check`，生产构建使用 `pnpm build`。仅构建宿主与应用前端时使用 `pnpm run pack`；`pnpm pack` 会生成 npm 分发压缩包。
