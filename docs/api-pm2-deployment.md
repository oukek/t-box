# 手动构建、自动上传、手动启动 PM2

所有工作流只支持 workflow_dispatch，不再因代码推送、tag、PR 或定时任务自动运行。新增 API PM2 package and upload，现有 Quality 和 API Docker OSS 保留为独立的手动工作流。

本流程：在 GitHub 手动点击 Run workflow → Linux 构建 → 校验独立生产目录 → 打包 → SSH/SCP 上传 → 服务器校验并解压到新的版本目录。**上传不会运行 PM2、数据库迁移、管理员初始化或切换 current，也不会写 shared 配置与用户数据。**

## GitHub 设置

仓库 Settings → Secrets and variables → Actions：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Variable | PM2_UPLOAD_DIR | 服务器项目根目录，如 /www/server/t-box；不填 releases 子目录，不支持空格或 .. |
| Variable（可选） | PM2_SSH_PORT | 默认 22 |
| Secret | PM2_SSH_HOST | 服务器 IPv4 或主机名 |
| Secret | PM2_SSH_USER | SSH 上传账户；建议与后续运行 PM2 的账户相同 |
| Secret | PM2_SSH_PASSWORD | SSH 账户登录密码；使用密码方式填写此项，无需私钥 |
| Secret（可选） | PM2_SSH_PRIVATE_KEY | 仅使用私钥方式时填写；密码和私钥至少配置一个 |
| Secret | PM2_SSH_KNOWN_HOSTS | 已核实的服务器 SSH 公钥，采用 known_hosts 格式 |

不要把 MySQL 密码、服务商密钥、生产 .env 放入构建 Secrets。SSH 信息只用于校验设置及最后的上传步骤；不会进入发布包。

支持账号密码登录。配置 PM2_SSH_PASSWORD 后优先使用密码，不需要 PM2_SSH_PRIVATE_KEY；密码通过 sshpass 的文件描述符传递，不放在命令行参数、日志或发布包中。GitHub runner 会安装 sshpass，服务器不需要安装它。密码不支持换行；服务器必须已经允许该账户的密码/PAM 登录，这套流程不会修改 SSH 服务配置，也不处理需要另行输入动态验证码的登录。

PM2_SSH_KNOWN_HOSTS 是服务器的公开身份信息，用于核实目标服务器；它不是你的登录私钥。密码方式也需要配置它。

先通过服务器控制台等可信渠道核对 SSH host key 指纹，再保存 known_hosts。默认端口行形如 host ssh-ed25519 AAAA...，非默认端口用 [host]:端口。工作流启用 StrictHostKeyChecking，连接时不会动态接受未知主机指纹。

服务器上传账户需要目标目录写权限、bash、tar、gzip 和 sha256sum 等标准 Linux 工具，不需要提前安装 PM2 来接收包。创建父目录并授权实际账户，例如：

```sh
sudo mkdir -p /www/server/t-box
sudo chown deploy:deploy /www/server/t-box
```

SSH 文件权限、服务器目录属主按实际账户配置。上传失败会使 Actions 失败，不忽略认证、校验或解压错误。GitHub 同时保留发布包 Artifact 14 天，便于排查与下载；服务器不会自动删除历史包或版本目录。

## 手动触发

提交工作流到默认分支后，打开 GitHub Actions → API PM2 package and upload → Run workflow，选择需要构建的分支。构建完成后自动上传；摘要显示实际版本目录。

每次 ID 包含完整提交 SHA、运行编号和重跑次数：

```text
sha-<40位SHA>-run-<编号>-attempt-<次数>
```

构建 runner 为 Linux x64，Node 24.21.0、pnpm 11.18.0。API 及 workspace 包先编译，再通过 pnpm deploy --legacy --prod 打包；node_modules 已包含第三方生产依赖及编译后的 workspace 包。服务器不需要 pnpm、源码或 TypeScript 编译器。

计算器 Web 产物作为初始化种子额外构建，因为现有生产目录要求独立 HTTPS 应用来源。发布包不包括其他前端或管理后台静态站点，二者仍独立部署。

上传时核对本地 SHA-256、远端 SHA-256 和 Linux 架构。原有同名版本目录会拒绝覆盖。ARM 服务器需先改为同架构的 Linux 构建 runner，不能把当前 x64 产物直接用于 ARM。本机 macOS 打包仅适合检查流程，不能直接作为 Linux 发布包上传。

## 服务器目录

```text
/www/server/t-box/
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
    bootstrap/app-artifacts/
    control/
      ecosystem.config.cjs
      prepare-release.mjs
      api.env.example
    release-info.json
  shared/                       # 由你手动准备
    api.env
    secrets/
    storage/
    app-artifacts/
    app-deployments/
    logs/
```

接收文件和解压目录默认私有，上传与运行最好使用同一账户。incoming 用于保留归档，releases 是解压的版本代码。上传中断可能留下 incoming 或隐藏的 staging 目录，运维核对后清理即可；工作流不清理正在运行的版本或 shared。

## 首次手动启动

服务器安装 Node 24.21.0（至少 24.15.0）与当前稳定版 PM2。宝塔可能提供多个 Node 版本，确认同一个运行账户的 node、pm2、PATH，避免 root 与普通用户各运行一套 PM2 daemon。

将下列 RELEASE_ID 替换为 Actions 摘要中的真实值：

```sh
cd /www/server/t-box
release="/www/server/t-box/releases/RELEASE_ID"
mkdir -p shared
cp "$release/control/api.env.example" shared/api.env
chmod 600 shared/api.env
```

编辑 shared/api.env，配置服务器 MySQL、Redis、前端/后台 CORS、反向代理地址，以及与宿主不同源的 APP_ARTIFACT_ORIGIN。建议宝塔预建数据库和专用用户。不要在升级时重复 cp 覆盖已有 api.env。

**迁移已有环境时**，在启动前恢复数据库，同时将旧 api/.secrets、api/.storage、output/app-artifacts、apps/<id>/deployment.local.json 分别迁移到 shared/secrets、shared/storage、shared/app-artifacts、shared/app-deployments/<id>/deployment.local.json。确保 PM2 运行账户有访问权限。必须保留 provider.key，不能让新环境生成另一把钥匙去解密旧数据库。

手动准备持久路径：

```sh
node "$release/control/prepare-release.mjs"
```

该命令只建立 api/.env、api/.secrets、api/.storage、应用发布目录等链接，创建共享日志目录，以及初始化缺失的计算器部署种子。已有 app 绑定、密钥、文件保留。它不启动 PM2，也不访问数据库。

手动执行数据库迁移；首次全新环境再创建管理员：

```sh
NODE_ENV=production node "$release/api/dist/init-db.js"
NODE_ENV=production node "$release/api/dist/admin/bootstrap.js"
```

初始管理员凭据保存在 shared/secrets/bootstrap-admin.txt；已有管理员不会重置。首次登录修改密码后删除该文件。

启动三个单实例进程（API、任务恢复 worker、应用产物服务）：

```sh
PM2_NODE="$(command -v node)" pm2 start "$release/control/ecosystem.config.cjs"
pm2 status
curl -fsS http://127.0.0.1:3000/api/v1/health
pm2 logs t-box-api --lines 100
pm2 save
```

ecosystem 使用绝对版本路径、fork 模式、单实例、关闭 watch，退出等待为 90 秒。不要直接开启 cluster 多实例：当前会话订阅、账本通知和部分限流仍需处理跨实例状态。

应用产物服务默认监听 127.0.0.1:6176；需要更改时，在启动配置命令前设置 ARTIFACT_PORT，Nginx upstream 也同步改。API 的 HOST/PORT 由 shared/api.env 配置。

配置开机恢复时，以实际运行账户执行 pm2 startup，再按照其提示执行 systemd 安装命令，之后 pm2 save。升级 Node 后需重新检查 startup 的 Node 路径。

## 宝塔站点与手动升级

宝塔宿主机 Nginx 将前端和后台的 /api/ 转发至 API，保留完整路径、开启 WebSocket Upgrade、关闭响应缓冲。可参考 deploy/api/nginx-api.conf.example。apps.example.com 独立 HTTPS 站点代理应用产物服务，参考 deploy/api/nginx-artifacts.conf.example。不要将整个项目根目录、shared、incoming 配成公开站点。

以后运行新的手动 workflow 只上传新版本，不改变现有 PM2 进程。你准备好升级并完成 MySQL/shared 备份后，再手动：

```sh
release="/www/server/t-box/releases/NEW_RELEASE_ID"
node "$release/control/prepare-release.mjs"
pm2 stop t-box-api t-box-worker
NODE_ENV=production node "$release/api/dist/init-db.js"
# 迁移成功后再切换；显式删除旧进程记录，确保使用新版本的绝对脚本路径。
pm2 delete t-box-api t-box-worker t-box-artifacts
PM2_NODE="$(command -v node)" pm2 start "$release/control/ecosystem.config.cjs"
curl -fsS http://127.0.0.1:3000/api/v1/health
pm2 save
```

迁移失败就停止后续步骤，检查实际进程和数据库状态；不能随意回退数据库。升级会有短暂停服，健康检查应同时确认 Redis 状态。代码回滚仅在数据库结构兼容旧代码时执行：选择旧 release，手动准备路径，再删除/启动对应 PM2 进程；不要自动执行 down 迁移。

API 日志自身对敏感字段脱敏，PM2 日志保存在 shared/logs。运行账户需要自行配置日志轮转和发布目录保留策略；保留当前版本、可回滚版本和必要备份，不删除共享数据。前端、后台静态产物及微信支付域名/回调仍需分别配置。

## 检查

脚本回归：node --test scripts/pm2-deployment.test.mjs。SSH/SCP 为测试替身，文件传输、SHA-256、解压和手动路径初始化使用真实本地临时文件；不会连接你的服务器。打包脚本还会对单独拷贝的产物导入所有生产模块，确认 workspace 依赖不指向源码仓库。

## 官方参考

- [GitHub 手动工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。
- [PM2 ecosystem 配置](https://pm2.keymetrics.io/docs/usage/application-declaration/)。
- [PM2 开机恢复](https://pm2.keymetrics.io/docs/usage/startup/)。

备份、隔离恢复与后台故障定位见 [运行与恢复](operations-and-recovery.md)。升级时必须同时停止旧 worker，避免旧代码使用新数据库继续执行。
