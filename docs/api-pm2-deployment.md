# 手动触发、自动上传与 PM2 启动

当前采用 OSS 主前端、后台和子应用静态站点，首次操作以 [OSS + PM2 部署手册](first-deployment.md) 为准。Actions 自动选择 OSS 模式，仅运行 API 和恢复 worker；下面提到的第三个本地产物服务适用于兼容的 `local` 模式。

所有工作流只支持 workflow_dispatch，不再因代码推送、tag、PR 或定时任务自动运行。新增 API PM2 package and upload，现有 Quality 和 API Docker OSS 保留为独立的手动工作流。

本流程：在 GitHub 手动点击 Run workflow → Linux 构建 → 校验独立生产目录 → 打包 → SSH/SCP 上传 → 服务器校验并解压到新的版本目录 → 准备持久路径 → 停止旧 API 与 worker → 数据库迁移 → 确保管理员存在 → 自动同步应用提交凭证 → 启动 API 和 worker → 健康检查 → 保存 PM2 和更新 current。`start_services` 默认勾选；取消勾选时只上传，不改变正在运行的服务。初始化会保留已有管理员，无需在工作流中另选初始化开关。

生产配置和已有数据必须事先准备好。迁移会更新数据库结构，发布前按 [运行与恢复](operations-and-recovery.md) 做好备份。启动失败会停止受管理的进程并使 Actions 失败，不自动回滚数据库或用旧代码继续连接已迁移的库。

## GitHub 设置

工作流已配置上传至 `root@8.163.69.101:22`，项目根目录为 `/www/wwwroot/tbox`。四项连接信息统一定义在工作流的 job `env` 中，校验、上传和运行摘要共用，无需再配置对应的 GitHub Variables 或主机/用户 Secrets。

在仓库 Settings → Secrets and variables → Actions → Secrets → New repository secret 配置：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | PM2_SSH_PASSWORD | 服务器 root 登录密码；使用密码方式填写此项，无需私钥 |
| Secret（可选） | PM2_SSH_PRIVATE_KEY | 仅使用私钥方式时填写；密码和私钥至少配置一个 |
| Secret | APP_IMPORT_TOKEN | 你设置的 32–128 位长期随机英文字母 / 数字 / `_` / `-`，推荐 64 位；与应用提交工作流共用 |

密码认证填写 `PM2_SSH_PASSWORD`，并配置应用提交凭证 `APP_IMPORT_TOKEN`、OSS 上传账号的 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`，共 4 个必填 Secrets；普通 Variables 只填 `DEPLOY_DOMAIN`、`OSS_REGION`。`deploy/settings.mjs` 统一生成四个站点地址、三个固定 Bucket 和发布目录，详见首次部署手册。密码放在 Secrets，不要放在普通 Variables。工作流未绑定命名 Environment，应配置仓库级 Secrets，而不是只填在某个 Environment 中。GitHub 规则见 [使用 Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。

不要把 MySQL 密码、服务商密钥、生产 .env 放入构建 Secrets。SSH 信息只用于校验设置及最后的上传步骤；不会进入发布包。

`APP_IMPORT_TOKEN` 在 GitHub 一次配置好。runner 只计算并通过 SSH 上传 SHA-256，原始 Token 不进入发布包、OSS、日志或服务器环境。哈希保存为版本目录 `control/app-import.sha256`，启动流程迁移数据库并确保管理员存在后自动登记为无自动到期的受限凭证。重复部署复用同值；修改 Secret 并重新部署后端会原子撤销旧的托管凭证。上传但不启动时保留哈希，之后启动该版本再同步，无需手工生成或 90 天续期。

支持账号密码登录。配置 PM2_SSH_PASSWORD 后优先使用密码，不需要 PM2_SSH_PRIVATE_KEY；密码通过 sshpass 的文件描述符传递，不放在命令行参数、日志或发布包中。GitHub runner 会安装 sshpass，服务器不需要安装它。密码不支持换行；服务器必须已经允许该账户的密码/PAM 登录，这套流程不会修改 SSH 服务配置，也不处理需要另行输入动态验证码的登录。

当前按部署要求暂时关闭 SSH 主机公钥校验，SSH / SCP 使用 `StrictHostKeyChecking=no`，不读取或保存用户及全局 known_hosts 文件，不再要求 `PM2_SSH_KNOWN_HOSTS`。SSH 仍加密传输并使用密码或私钥登录，但不会核验目标服务器身份。发布包的本地 / 远端 SHA-256、架构检查与启动健康检查继续执行。

服务器需已允许 `root` 密码登录，阿里云安全组及系统/宝塔防火墙需允许 GitHub runner 访问 TCP 22。仓库的 Settings → Actions → General 中需启用 GitHub Actions，并允许工作流使用的 GitHub 官方 Actions 与 `pnpm/action-setup`；现有 `contents: read` 权限足以完成此上传流程，无需额外 PAT 或仓库写权限。

服务器上传账户需要目标目录写权限、bash、tar、gzip 和 sha256sum 等标准 Linux 工具，不需要提前安装 PM2 来接收包。创建父目录并授权实际账户，例如：

```sh
mkdir -p /www/wwwroot/tbox
```

SSH 文件权限、服务器目录属主按实际账户配置。上传失败会使 Actions 失败，不忽略认证、校验或解压错误。GitHub 同时保留发布包 Artifact 14 天，便于排查与下载；服务器不会自动删除历史包或版本目录。

## 手动触发

提交工作流到默认分支后，打开 GitHub Actions → API PM2 package and upload → Run workflow，选择需要构建的分支。`start_services` 控制上传后是否自动迁移、初始化所需管理员、同步应用凭证、启动与检查健康。构建完成后自动上传；摘要显示实际版本目录和启动结果。

服务器必须提前安装 Node 24.21.0（最低 24.15.0）和 PM2，SSH 非交互会话中也必须能找到 `node`、`pm2`。首次尚未准备 `shared/api.env` 时，可以先取消 `start_services` 上传，再按下节复制模板并填写实际配置。上传账户与 PM2 运行账户应一致，目前均为 root。

每次 ID 包含完整提交 SHA、运行编号和重跑次数：

```text
sha-<40位SHA>-run-<编号>-attempt-<次数>
```

构建 runner 为 Linux x64，Node 24.21.0、pnpm 11.18.0。API 及 workspace 包先编译，再通过 pnpm deploy --legacy --prod 打包；node_modules 已包含第三方生产依赖及编译后的 workspace 包。服务器不需要 pnpm、源码或 TypeScript 编译器。

计算器、记账、日历和时间的独立 Web 产物作为初始化种子额外构建，输出 bootstrap-artifacts 并在 SSH 上传前发布至 OSS。发布包记录此来源和分发模式，服务器配置不一致时会在停止旧服务前拒绝启动。已有应用绑定和已发布版本不会被种子覆盖。主前端和后台使用 Web OSS deployment 独立部署。

业务文件使用 `tboxos/uploads/resources/`，运行中的 API / worker 需要服务器 `shared/api.env` 内的 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`；`OSS_REGION` 和业务 Bucket 从 Actions 发布包读取。GitHub 上传凭据不会自动进入服务器。账号授权及 Bucket 跨域设置按 [首次部署](first-deployment.md) 操作。PM2 在停止旧服务前校验业务文件配置完整性。

上传时核对本地 SHA-256、远端 SHA-256 和 Linux 架构。原有同名版本目录会拒绝覆盖。ARM 服务器需先改为同架构的 Linux 构建 runner，不能把当前 x64 产物直接用于 ARM。本机 macOS 打包仅适合检查流程，不能直接作为 Linux 发布包上传。

## 服务器目录

```text
/www/wwwroot/tbox/
  incoming/<releaseId>/
    runtime.tar.gz
    runtime.tar.gz.sha256
    release.json
  releases/<releaseId>/
    api/
      dist/
      node_modules/
      package.json
      check-runtime.mjs
    scripts/
    control/
      ecosystem.config.cjs
      prepare-release.mjs
      start-release.mjs
      api.env.example
    release-info.json
  shared/                       # 由你手动准备
    api.env
    secrets/
    logs/
```

接收文件和解压目录默认私有，上传与运行最好使用同一账户。incoming 仅临时接收归档，完成解压后清理；失败时也清理本次 incoming / staging，不保留安装压缩包。SSH 断开导致清理失败时工作流会报错，恢复后只清理提示的本次临时目录。releases 保留后端运行代码与可回滚版本，不含子应用静态文件。

## 首次配置与启动入口

服务器安装 Node 24.21.0（至少 24.15.0）与当前稳定版 PM2。宝塔可能提供多个 Node 版本，确认同一个运行账户的 node、pm2、PATH，避免 root 与普通用户各运行一套 PM2 daemon。

将下列 RELEASE_ID 替换为 Actions 摘要中的真实值：

```sh
cd /www/wwwroot/tbox
release="/www/wwwroot/tbox/releases/RELEASE_ID"
mkdir -p shared
cp "$release/control/api.env.example" shared/api.env
chmod 600 shared/api.env
```

编辑 shared/api.env，填写服务器 MySQL、业务文件 OSS AccessKey 和可选 Redis。Actions 包自动携带应用域名、OSS 模式、构建包桶地址与目录；跨域默认开放，默认信任本机 Nginx，PM2 自动设置独立恢复 worker。高级覆盖项见 [API 环境配置](api-environment.md)。源码部署没有 Actions 元信息时仍需提供独立应用域名。建议宝塔预建数据库和专用用户。不要在升级时重复 cp 覆盖已有 api.env。

**迁移已有环境时**，先恢复数据库与原 provider.key 到 shared/secrets，保持密钥与数据库配套。旧本地资源按 [迁移说明](api-environment.md) 上传并校验 OSS 后删除。不要继续挂载本地静态产物目录；确认历史版本在 OSS 齐全后再清理旧副本。

配置完成后，通过统一脚本准备运行配置、执行迁移并启动 API / worker 两个单实例进程：

```sh
node "$release/control/start-release.mjs" --init-admin
pm2 status
pm2 logs t-box-api --lines 100
```

`--init-admin` 只在首次安装时使用。脚本先检查运行配置、OSS 和初始应用摘要，建立 api/.env、api/.secrets 链接及必要日志目录，不创建本地业务文件或静态产物目录。之后停止旧 worker 和 API，运行 `api/dist/init-db.js`，按选项运行管理员初始化，再用新版本的绝对路径启动 API / worker，并移除旧本地产物服务。

初始管理员凭据保存在 shared/secrets/bootstrap-admin.txt；已有管理员不会重置。首次登录修改密码后删除该文件。

启动成功要求 API 健康端点的 MySQL 正常、已配置 Redis 时 Redis 也正常，并且 API / worker 两个进程连续三次检查均 online、PID 稳定、运行路径属于新版本。仅 HTTP 200 或 PM2 显示短暂 online 不算成功。默认最多检查 60 次，每次 HTTP 请求最多 3 秒、检查间隔 1 秒。通过后更新 `current`，保留原链接为 `previous`，并运行 `pm2 save`。使用 root `.pm2-deploy.lock` 防止并发迁移；异常中断留下锁时，先核对其中 owner.json 的进程与部署状态，再清理确认失效的锁。

ecosystem 使用绝对版本路径、fork 模式、单实例、关闭 watch，退出等待为 90 秒。不要直接开启 cluster 多实例：当前会话订阅、账本通知和部分限流仍需处理跨实例状态。

不再启动本地应用产物服务，也不需要 ARTIFACT_PORT。API 的 HOST/PORT 可在 shared/api.env 覆盖。`prepare-release.mjs` 仍可单独执行，它只准备运行配置与必要目录，不启动服务或迁移。

配置开机恢复时，以实际运行账户执行 pm2 startup，再按照其提示执行 systemd 安装命令，之后 pm2 save。升级 Node 后需重新检查 startup 的 Node 路径。

## 宝塔站点与手动升级

宝塔宿主机 Nginx 只为 API 域名提供反向代理，保留 /api/、WebSocket Upgrade 并关闭响应缓冲，参考 deploy/api/nginx-api.conf.example。主站、后台、apps.example.com 均直接绑定各自 OSS Bucket；不再代理本地应用产物服务。不要将项目根目录、shared、incoming 配成公开站点。

以后运行新的手动 workflow 默认完成上传和启动。若选择只上传，做好 MySQL/shared 备份后可以在服务器运行：

```sh
release="/www/wwwroot/tbox/releases/NEW_RELEASE_ID"
node "$release/control/start-release.mjs"
```

迁移失败就停止后续步骤，检查实际进程和数据库状态；不能随意回退数据库。升级会有短暂停服，健康检查应同时确认 Redis 状态。代码回滚仅在数据库结构兼容旧代码时执行：选择旧 release，手动准备路径，再删除/启动对应 PM2 进程；不要自动执行 down 迁移。

API 日志自身对敏感字段脱敏，PM2 日志保存在 shared/logs。运行账户需要自行配置日志轮转和发布目录保留策略；保留当前版本、可回滚版本和必要备份，不删除共享数据。前端、后台静态产物及微信支付域名/回调仍需分别配置。

## 服务器 git pull 后部署

此备用入口只构建并启动后端，不持有 OSS 上传凭据。OSS 模式的首次静态种子发布应使用上述 Actions；从源码首次部署时，需要先将该构建对应的 bootstrap-artifacts 发布到同一 APP_ARTIFACT_ORIGIN，不能只启动 API 就认为子应用资源已上线。

也可以在服务器安装相同的 Node、pnpm 11.18.0 和 PM2，将完整 monorepo 克隆到 `/www/wwwroot/tbox/source`。API 依赖其他 workspace，不能只下载 api 子目录。私有仓库需为服务器配置只读 GitHub Deploy key 等仓库读取凭证；服务器 root 登录密码不用于 GitHub 克隆。源码目录是构建目录，PM2 仍运行独立 `releases/<releaseId>` 中的生产依赖与编译产物。

第一次克隆后，先准备配置（已有 shared/api.env 时跳过复制）：

```sh
mkdir -p /www/wwwroot/tbox
cd /www/wwwroot/tbox
git clone git@github.com:oukek/t-box.git source
mkdir -p shared
cp source/deploy/pm2/api.env.example shared/api.env
chmod 600 shared/api.env
# 编辑 shared/api.env 为服务器实际配置；迁移已有环境时同时恢复密钥与持久数据。
```

以后在源码目录执行：

```sh
cd /www/wwwroot/tbox/source
git pull --ff-only
node deploy/pm2/deploy-source.mjs
# 首次需要创建管理员时追加 --init-admin
```

该入口自动执行锁定依赖安装（包括构建工具）、构建 API/workspace/四个应用种子、校验独立生产包、解压新版本，最后调用同一个 `start-release.mjs`。即使服务器 NODE_ENV=production，也显式保留编译器；安装步骤使用非交互模式。首次推荐直接运行 Node 入口，避免 pnpm 在进入脚本前按旧的生产依赖状态自动安装。依赖已准备好的源码目录也提供 `pnpm deploy:pm2` 别名。

不会直接在源码目录运行 PM2，也不会 reset/clean Git 文件。tracked 文件有未提交修改时会拒绝部署；拉取与合并由操作员明确执行，脚本不隐式切换分支。发布根目录可通过 `PM2_DEPLOY_ROOT` 调整，默认 `/www/wwwroot/tbox`。源码构建使用 `.pm2-build.lock`，启动阶段与 Actions 共用 `.pm2-deploy.lock`。

## 检查

脚本回归：node --test scripts/pm2-deployment.test.mjs。SSH/SCP 为测试替身，文件传输、SHA-256、解压和手动路径初始化使用真实本地临时文件；不会连接你的服务器。打包脚本还会对单独拷贝的产物导入所有生产模块，确认 workspace 依赖不指向源码仓库。

## 官方参考

- [GitHub 手动工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。
- [PM2 ecosystem 配置](https://pm2.keymetrics.io/docs/usage/application-declaration/)。
- [PM2 开机恢复](https://pm2.keymetrics.io/docs/usage/startup/)。

备份、隔离恢复与后台故障定位见 [运行与恢复](operations-and-recovery.md)。升级时必须同时停止旧 worker，避免旧代码使用新数据库继续执行。
