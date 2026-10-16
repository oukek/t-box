# 独立应用：Actions → OSS → 后台待发布

首次上线按 [OSS + PM2 操作顺序](first-deployment.md) 执行。当前工作流先把可直接浏览的应用文件上传到 `APPS_OSS_BUCKET`（默认 `tboxos-app`），逐文件通过 `APP_ARTIFACT_ORIGIN` 校验，再将公开 JSON 包上传到同桶 `builds/` 并登记待发布版本。无需私有 Bucket 或签名下载 URL。OSS 模式不通过服务器提供公开静态文件；服务器保留校验及备份副本。

工作流 `.github/workflows/application-release.yml` 仅支持手动运行，API Docker/PM2 工作流保持原有用途。选择应用，填写新版本号和更新说明后，工作流构建该应用及依赖、上传公开 OSS，通过服务器导入接口登记为 `submitted`（已提交、未上架）。后台“应用发布”可直接选中该版本并点击发布；已安装用户沿用原版本，按已有更新机制升级。

## 应用下拉列表

GitHub 的 `workflow_dispatch` 下拉选项是静态 YAML，无法运行脚本后立即改变当前运行页面。新增应用后在本地执行以下命令，将生成的工作流一并提交到 Git，默认分支中的工作流更新后即可在 Actions 选择。参见 [GitHub 手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。

```bash
pnpm apps:workflow
pnpm check:apps
```

脚本扫描 `apps/*/build.config.json`，验证应用 ID、独立 Web 的 `index.html` / build 命令、workspace 包和发布声明模块。没有独立构建声明的应用不会进入下拉列表。目前支持计算器、日历、记账与时间；设置、市场仍是宿主内置页面。图片是工具能力模块，没有可发布的应用页面。

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

发布元信息从应用自己的发布声明读取，不另维护名称、图标、类型清单。填写的版本号作为此次平台发布版本；应用如在界面显示自身源代码版本，也应同步更新它自己的 manifest/package。静态构建必须使用相对资源路径（Vite `base: './'`）。本地打包检查：

`releaseModule` 可指向 `server/dist/*.js` 或 `contracts/dist/*.js`，`releasePackage` 对应其 workspace 包。纯前端应用可以在 contracts 包声明 `backend: { type: 'none', binding: '' }` 的 Web release，无需实现服务器业务模块。

```bash
pnpm pack:application calculator 1.0.1
pnpm test:application-release
```

输出 `output/application-releases/calculator/1.0.1/`，包含以 SHA-256 命名的 JSON 包及 `release.json`。JSON 包含静态文件、文件清单摘要、发布元信息与更新说明；不是服务器可执行代码。单文件最多 5 MiB，总静态文件最多 20 MiB / 2000 文件，编码后的包最多 30 MiB。不包含 `.env`、凭证或服务端代码。Web 构建时仍须避免把私密配置写入公开 JS。

## 服务器首次接入

先部署包含本次新增接口和迁移的 API，手动执行数据库迁移：

```bash
# 源码部署
pnpm db:init
# 或 PM2 dist 部署：进入 releases/<版本>/api
node dist/init-db.js
# Docker 部署：在 deploy/api 目录
docker compose run --rm api node dist/init-db.js
```

新增 `application_import_credentials`（受限凭证，仅存 token 哈希）与 `application_build_imports`（构建来源与幂等记录）两张表；不会修改现有应用的线上版本。

服务器 API 环境配置（PM2 的 shared/api.env，或 Docker 的部署 .env）：

```dotenv
APP_IMPORT_OSS_ORIGIN=https://tboxos-app.oss-cn-hangzhou.aliyuncs.com
APP_IMPORT_OSS_PREFIX=builds
APP_ARTIFACT_ORIGIN=https://apps.example.com
```

`APP_IMPORT_OSS_ORIGIN` 必须精确匹配 `tboxos-app` 的 OSS 公网桶域名，不带结尾 `/`，地域改为实际值。目前支持标准阿里云 OSS 公网桶域名，不接受内网、自定义域名、HTTP、任意跳转。API 直接下载公开 JSON，无须配置 OSS AccessKey。浏览器通过同桶的自定义域名 `APP_ARTIFACT_ORIGIN` 加载 `<应用ID>/<产物摘要>/` 中的网页。服务器仍需持久化 PM2 shared/output/app-artifacts 或 Docker data/app-artifacts 中的校验和备份副本。

在服务器创建一个仅允许提交指定应用的导入凭证，管理员账号须已存在且启用：

```bash
# 源码：管理员用户名、应用 ID（多个以逗号分隔）、有效天数（默认 90，最多 365）
pnpm --filter @t-box/api apps:credential create admin calculator 90
# PM2 dist：进入 releases/<版本>/api
node dist/application-platform/import-credential-cli.js create admin calculator 90
# Docker：在 deploy/api 目录
docker compose run --rm api node dist/application-platform/import-credential-cli.js create admin calculator 90
```

命令把 token 写入 API 的 `.secrets/app-build-<凭证ID>.txt`（权限 0600），不在日志打印 token。把其中内容设置为 GitHub Secret `APP_IMPORT_TOKEN`，妥善保管或删除本地明文副本。凭证只能提交显式允许的应用，不能用来登录后台、修改版本、上架应用、执行 SQL 或安装后端代码。禁用关联管理员会让凭证失效；轮换时先创建新凭证、更新 Secret，再撤销旧凭证：

```bash
node dist/application-platform/import-credential-cli.js revoke <凭证ID>
```

修改 API 环境后手动重启 API。宝塔/Nginx 应代理 `/api/v1/application-builds` 到 API。接口请求只有下载地址和摘要，包由 API 拉取，因此无须把反向代理请求体限制提高到 30 MiB；若下载速度较慢，为该路径将代理响应超时设置为至少 90 秒。

## GitHub 配置

Repository → Settings → Secrets and variables → Actions：

| 类型 | 名称 | 示例 / 用途 |
| --- | --- | --- |
| Variable | `OSS_REGION` | `cn-hangzhou` |
| Variable | `APPS_OSS_BUCKET` | 可不填，默认 `tboxos-app`；网页与构建包共用 |
| Variable | `APP_ARTIFACT_ORIGIN` | 独立应用静态站点的自定义 HTTPS 来源 |
| Variable | `OSS_ENDPOINT` | 可选，`https://oss-cn-hangzhou.aliyuncs.com`，必须公网 endpoint |
| Variable | `APP_OSS_PREFIX` | 可选，默认 `builds`，须与服务器匹配；独立于 Docker 的 `OSS_PREFIX` |
| Variable | `APP_IMPORT_API_URL` | `https://api.example.com/api/v1/application-builds` |
| Secret | `OSS_ACCESS_KEY_ID` | 有应用静态目录和 `builds/` 上传及设置对象 ACL 权限的 RAM AccessKey |
| Secret | `OSS_ACCESS_KEY_SECRET` | 对应 Secret |
| Secret | `OSS_SESSION_TOKEN` | 可选，临时 STS 凭证使用 |
| Secret | `APP_IMPORT_TOKEN` | 上述服务器生成的受限导入凭证 |

RAM 需要目标目录的 `oss:PutObject`、`oss:PutObjectAcl` 及客户端实际使用的分片上传权限。下载通过公开 HTTPS，不需要签名，也不依赖下载凭据。GitHub 的旧 `OSS_BUCKET` 变量不再使用。工作流固定 ossutil 2.4.0 并校验下载工具 SHA-256。

手动运行 **Application OSS submission**：选择 `calculator`，填写未使用版本如 `1.0.1`、更新说明。不要直接在版本里填 shell 命令；输入由环境变量传递，构建脚本仍会严格校验应用和版本。

## 导入、重试与发布边界

1. 将网页上传至 `oss://tboxos-app/<appId>/<产物摘要>/` 并验证公开访问，再将构建包公开上传至 `oss://tboxos-app/builds/<appId>/<version>/<包SHA256>.json`，使用标准 OSS HTTPS 地址下载。
2. 工作流调用 `POST /api/v1/application-builds`，带 Bearer 导入凭证、应用、版本、摘要、公开 URL 及 GitHub repository/commit/runId。导入凭证不会写入 OSS 包或公开日志。
3. 服务器验证凭证权限、受信桶/目录、60 秒下载超时与大小、包 SHA-256、路径及每文件摘要。静态产物使用临时目录原子写入持久目录。
4. 同一个数据库事务登记构建来源、发布定义、提交状态与审计记录。`published=0`，当前线上版本不变。后端绑定、权限和工具契约继承服务器已有可信发布，不接受构建包任意声明。发布就绪检查不通过则不登记。
5. 网络不确定或 5xx/429 最多尝试提交 5 次；同应用/版本/包摘要返回原版本（包括管理员随后已上架的情况）。并发重试共用应用行锁；同版本不同内容返回 409，需新版本号，不能覆盖旧版本。权限/校验/版本冲突等 4xx 不重试。
6. 管理员在已有“应用发布”页面审核更新说明与就绪状态，再手动点击发布。CI 没有上架接口权限。

OSS 上传成功但登记失败时，OSS 包会保留；不会产生自动上线。可修复配置后重新运行同版本同构建，或用新版本重新构建。不同平台/Node/依赖可能导致构建字节变化，变动时须使用新版本。无登记的本地产物目录可能保留以便重试，后续清理应先核对所有发布/安装引用。

该链路发布独立应用的静态前端和已有可信能力契约，不热加载未知服务端代码。若应用此次更新改变了 API 业务实现、工具参数、权限契约或新后端绑定，应先部署相应 API/独立后端并迁移数据库，再提交应用版本；单独上传 Web 包不能升级运行中的 Node 服务。网页、Android/iOS 的 Web 容器继续通过既有安装/更新机制加载版本，原生壳本身仍按商店流程发布。

验证命令：`pnpm test:application-release`、`pnpm test:application-import`（后者使用已迁移的本地 MySQL，创建并清理测试应用/管理员/凭证；OSS 网络通过固定模拟对象验证，不访问真实桶）。
