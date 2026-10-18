# 独立应用：Actions → OSS → 后台待发布

首次上线按 [OSS + PM2 操作顺序](first-deployment.md) 执行。当前工作流固定把应用网页上传到 `tboxos-app`，通过 `https://apps.<主域名>` 校验，再将公开 JSON 包上传到同桶 `builds/` 并登记待发布版本。无需私有 Bucket 或签名下载 URL。OSS 模式不通过服务器提供公开静态文件；服务器只在内存中读取与校验 OSS 文件，不保留应用文件副本。

工作流 `.github/workflows/application-release.yml` 仅支持手动运行。运行时只需选择中文应用选项，例如“记账 (ledger)”；版本号自动读取应用发布声明引用的 `manifest.version`。工作流构建该应用及依赖、上传公开 OSS，通过服务器导入接口登记为 `submitted`（待发布）。随后进入后台“应用发布”→ 该版本的“编辑更新信息”，填写更新说明与应用内更新提示，保存后审核发布；已安装用户沿用原版本，按已有更新机制升级。

**所有 GitHub 配置一次填齐，包括 `APP_IMPORT_TOKEN`。** 你在 GitHub 设置一个长期随机字符串，PM2 后端部署自动同步其哈希；子应用发布直接使用同一个 Secret，不需要服务器生成命令，也没有定期续期步骤。所有 Actions 共用 `deploy/settings.mjs`，普通变量只保留主域名和 OSS 地域，见下方 [GitHub 配置](#github-配置)。

## 应用下拉列表

GitHub 的 `workflow_dispatch` 下拉选项是静态 YAML，无法运行脚本后立即改变当前运行页面。新增应用后在本地执行以下命令，将生成的工作流一并提交到 Git，默认分支中的工作流更新后即可在 Actions 选择。参见 [GitHub 手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。

```bash
pnpm apps:workflow
pnpm check:apps
```

脚本扫描 `apps/*/build.config.json`，验证应用 ID、独立 Web 的 `index.html` / build 命令、workspace 包和发布声明模块。选项显示名称取自该应用 `web/index.html` 的 `<title>`，后面保留应用 ID；名称无需在工作流中重复维护，构建仍使用内部 ID。没有独立构建声明的应用不会进入下拉列表。目前支持计算器、日历、记账与时间；设置、市场仍是宿主内置页面。图片是工具能力模块，没有可发布的应用页面。

声明示例（见 `apps/calculator/build.config.json`）：

```json
{
  "appId": "calculator",
  "package": "@t-box/calculator-web",
  "releasePackage": "@t-box/calculator-server",
  "releaseModule": "server/dist/release.js",
  "releaseExport": "calculatorRelease"
}
```

发布元信息从应用自己的发布声明读取，不另维护名称、图标、类型清单。**发布版本以 `manifest.version` 为准，不读取 workspace 的 `package.json.version`，也不在 Actions 中输入或覆盖。** 更新前在代码里修改该应用的 `manifest.version` 并提交；新内容必须使用未登记过的版本号，同版本不同内容会被拒绝，不会自动递增或覆盖。静态构建必须使用相对资源路径（Vite `base: './'`）。

| 应用 | 修改版本号的位置 |
| --- | --- |
| 计算器 | `apps/calculator/contracts/src/catalog.ts` 的 `calculatorManifest.version` |
| 日历 | `apps/calendar/contracts/src/types.ts` 的 `calendarManifest.version` |
| 记账 | `apps/ledger/contracts/src/manifest.ts` 的 `ledgerManifest.version` |
| 时间 | `apps/time/contracts/src/index.ts` 的 `timeManifest.version` |

本地打包检查：

`releaseModule` 可指向 `server/dist/*.js` 或 `contracts/dist/*.js`，`releasePackage` 对应其 workspace 包。纯前端应用可以在 contracts 包声明 `backend: { type: 'none', binding: '' }` 的 Web release，无需实现服务器业务模块。

```bash
pnpm pack:application calculator
pnpm test:application-release
```

输出 `output/application-releases/<appId>/<manifest.version>/`，包含以 SHA-256 命名的 JSON 包及 `release.json`。JSON 包含静态文件、文件清单摘要和发布元信息，更新说明初始为空；更新说明与提示在后台填写，不参与构建摘要。单文件最多 5 MiB，总静态文件最多 20 MiB / 2000 文件，编码后的包最多 30 MiB。不包含 `.env`、凭证或服务端代码。Web 构建时仍须避免把私密配置写入公开 JS。

## 后端自动接入

先把下面的 GitHub 配置全部填好，再运行 **后端部署（PM2）**，保持 `start_services` 勾选。流程先做只读数据库兼容性预检，通过后才停止旧服务、执行初始化、确保管理员存在、同步应用提交凭证，再启动 API 和 worker。已有管理员账号不会被重置。

这是首次接入、修改 Token 或新增应用授权时的依赖；后端和凭证已就绪后，已有子应用可以直接单独更新，无需每次先跑后端。主前端、后台、后端工作流也可分别运行；涉及新接口、数据库迁移或新权限契约时先部署相应后端。

`APP_IMPORT_TOKEN` 使用 32–128 位随机英文字母 / 数字 / `_` / `-`，推荐密码管理器生成 64 位。runner 只把它的 SHA-256 通过 SSH 上传，独立于可下载的后端包和 OSS 文件；当前 SSH 主机公钥校验暂时关闭。服务器版本目录 `control/app-import.sha256` 与数据库只保存哈希，没有原始 Token；部署临时文件自动清理。

同步凭证不设置自动到期，重复部署同一个值复用现有凭证。作用范围自动取自后端包内可信的独立应用清单，不能用来登录后台、直接上架或安装后端代码。关联管理员被禁用后仍会拒绝请求。

需要更换时，更新 GitHub Secret 并重新部署后端；同步在数据库事务内撤销旧的托管凭证、登记新的凭证，保留历史构建来源。旧 Token 随即失效。手工撤销过的 Token 不会被同值部署重新启用，需要换一个新值。

无需在服务器 `.env` 中配置 `APP_IMPORT_TOKEN`。应用域名、公开 OSS 桶与目录由 PM2 包自动提供，API 在内存中下载和校验公开对象，不保存静态文件副本。API 的业务文件上传账号仍按 [部署清单](first-deployment.md) 填在服务器配置中。

改变主域名、地域或 `deploy/settings.mjs` 后，先准备好对应的 DNS / OSS 配置并重新发布后端，再提交子应用。

## GitHub 配置

Repository → Settings → Secrets and variables → Actions，配置 Repository Secrets / Variables；工作流没有绑定命名 Environment。

| 类型 | 名称 | 填什么 |
| --- | --- | --- |
| Variable | `DEPLOY_DOMAIN` | 主域名，如 `example.com`，不带协议、路径或端口 |
| Variable | `OSS_REGION` | 实际 Bucket 地域，如 `cn-hangzhou`，不带 `oss-` |
| Secret | `OSS_ACCESS_KEY_ID` | GitHub 发布 RAM 账号的 AccessKey ID，复用首次部署配置 |
| Secret | `OSS_ACCESS_KEY_SECRET` | 上述账号对应 Secret，复用首次部署配置 |
| Secret | `APP_IMPORT_TOKEN` | 你设置的 32–128 位长期随机字符串，后端部署自动同步哈希 |

其余全部由 [deploy/settings.mjs](../deploy/settings.mjs) 固定或推导：应用桶 `tboxos-app`、构建目录 `builds/`、应用地址 `https://apps.<主域名>`、导入接口 `https://api.<主域名>/api/v1/application-builds`、对应地域的 OSS 公网 endpoint。脚本通过 GitHub 的环境文件传给后续步骤，不需要创建同名 Repository Variables。

四个发布工作流统一使用上述两个普通变量。旧的站点 URL、Bucket、目录和 endpoint Variables 已不再读取，可以删除；当前工作流只使用长期 RAM AccessKey，已移除 `OSS_SESSION_TOKEN`。密钥和受限提交凭证继续放在 Secrets，不能写入公开脚本。

Run workflow 只选择应用；版本来自代码，更新说明与提示在后台维护。输出目录与构建来源由 GitHub 自动提供，也不用额外配置。

RAM 需要目标目录的 `oss:PutObject`、`oss:PutObjectAcl` 及客户端实际使用的分片上传权限。下载通过公开 HTTPS，不需要签名，也不依赖下载凭据。GitHub 的旧 `OSS_BUCKET` 变量不再使用。工作流固定 ossutil 2.4.0 并校验下载工具 SHA-256。

手动运行 **子应用发布（OSS）**：选择“数学计算器 (calculator)”即可。脚本严格匹配生成的应用选项，构建后校验 `manifest.version` 并传给上传步骤；Actions 摘要会展示实际版本号。

## 导入、重试与发布边界

1. 将网页上传至 `oss://tboxos-app/<appId>/<产物摘要>/` 并验证公开访问，再将构建包公开上传至 `oss://tboxos-app/builds/<appId>/<version>/<包SHA256>.json`，使用标准 OSS HTTPS 地址下载。
2. 工作流调用 `POST /api/v1/application-builds`，带 Bearer 导入凭证、应用、版本、摘要、公开 URL 及 GitHub repository/commit/runId。导入凭证不会写入 OSS 包或公开日志。
3. 服务器验证凭证权限、受信桶/目录、60 秒下载超时与大小、包 SHA-256、路径及每文件摘要，再直接读取 OSS 中已上传的静态文件核对完整性；校验在内存中完成，不写入服务器持久目录。
4. 同一个数据库事务登记构建来源、发布定义、提交状态与审计记录。`published=0`，当前线上版本不变。后端绑定、权限和工具契约继承服务器已有可信发布，不接受构建包任意声明。发布就绪检查不通过则不登记。
5. 网络不确定或 5xx/429 最多尝试提交 5 次；同应用/版本/包摘要返回原版本（包括管理员随后已上架的情况）。并发重试共用应用行锁；同版本不同内容返回 409，需新版本号，不能覆盖旧版本。权限/校验/版本冲突等 4xx 不重试。
6. 管理员在“应用发布”页面点击“编辑更新信息”，填写更新说明和提示，保存后审核就绪状态并手动点击发布。待发布版本允许修改这两类信息，版本号、构建产物、权限与后端绑定仍锁定；保存会增加 revision 并记录审计，过期页面需刷新。构建重试不会覆盖后台填写的内容，已发布与历史版本不可用此入口修改。CI 没有编辑更新信息或上架接口权限。

OSS 上传成功但登记失败时，OSS 文件和构建包会保留；不会产生自动上线。可修复配置后重新运行同版本同构建，或用新版本重新构建。不同平台/Node/依赖可能导致构建字节变化，变动时须使用新版本。清理 OSS 中未登记的对象前，应先核对所有发布/安装引用。

该链路发布独立应用的静态前端和已有可信能力契约，不热加载未知服务端代码。若应用此次更新改变了 API 业务实现、工具参数、权限契约或新后端绑定，应先部署相应 API/独立后端并迁移数据库，再提交应用版本；单独上传 Web 包不能升级运行中的 Node 服务。网页、Android/iOS 的 Web 容器继续通过既有安装/更新机制加载版本，原生壳本身仍按商店流程发布。

验证命令：`pnpm test:application-release`、`pnpm test:application-import`（后者使用已初始化的隔离 MySQL 测试库，创建并清理测试应用/管理员/凭证；OSS 网络通过固定模拟对象验证，不访问真实桶）。
