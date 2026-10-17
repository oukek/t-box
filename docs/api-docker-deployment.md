# 可选 Docker 部署：文件全部交给 OSS

正式方案使用 [OSS 网站 + PM2 后端](first-deployment.md)。只有需要 Docker 时才使用本文；所有 Actions 仍手动运行。

## 1. GitHub 和 OSS

沿用三个公开读、禁止公开写的 Bucket：

| Bucket | 内容 |
| --- | --- |
| tboxos | 主站、uploads/resources/ 下的业务文件 |
| tboxos-admin | 后台、docker/releases/ 下的公开镜像包 |
| tboxos-app | 子应用静态文件及 builds/ 构建包 |

GitHub 配置 OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET（Secrets），以及 DEPLOY_DOMAIN、OSS_REGION（仅这两个 Variables）。`deploy/settings.mjs` 自动生成站点地址，固定使用 tboxos-admin/docker/ 存 Docker 包、tboxos-app 存应用文件，与 PM2 / 前端发布共用设置。首次准备按 [首次部署](first-deployment.md) 执行。

后端镜像发布（Docker / OSS） 工作流构建后端镜像，把子应用静态文件单独导出、上传并逐文件验证 OSS，再上传镜像归档、校验文件，最后发布 release.json。应用文件不会装进运行镜像；镜像只保留后端程序和 bootstrap-applications.json 初始摘要配置。

公开镜像布局为 `oss://tboxos-admin/docker/releases/<RELEASE_ID>/`，含 image.tar.gz、image.tar.gz.sha256、release.json。归档不含生产 env、密钥或用户文件。镜像本地标签为 t-box-api:<RELEASE_ID>，无需镜像仓库、docker login 或 docker pull。

## 2. 服务器准备

使用 Linux Docker、Compose v2.20+、bash、jq、gzip、sha256sum、flock 和 ossutil 2.x。仓库脚本固定使用官方 ossutil 2.4.0，并校验安装包 SHA-256。

把 deploy/api 下的部署脚本、compose.yaml 和 env 示例复制到部署目录，例如 /www/server/t-box：

```sh
cd /www/server/t-box
cp .env.example .env
cp oss.env.example oss.env
chmod 600 .env oss.env
mkdir -p data/secrets
chown -R 1000:1000 data
chmod 700 data/secrets
```

.env 填写 MySQL、可选 Redis、业务文件 OSS_REGION / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET，以及独立的 APP_ARTIFACT_ORIGIN HTTPS 域名。业务 Bucket 默认 tboxos。API_IMAGE 首次保留占位值，部署成功后脚本会更新为实际标签。

oss.env 用于下载镜像包：OSS_BUCKET=tboxos-admin，OSS_PREFIX=docker，并填写实际地域。ossutil 凭据由部署账户配置；Compose 不会把 oss.env 加载到 API。运行时业务文件上传密钥仍需在 .env 中提供。

Compose 使用宿主机网络，API 监听 127.0.0.1:3000，MySQL / Redis 使用服务器实际地址；不对外发布 API 端口。后台与 API 继续使用同一主域下的 HTTPS 子域名。只为 API 配置 Nginx，保留 /api/、WebSocket、微信通知原始请求体及请求头。主站、后台和子应用域名直接绑定 OSS。

后端程序、配置、密钥与必要日志是运行文件。业务附件、图片、应用静态文件和备份归档长期保存到 OSS，不挂载 data/storage、data/app-artifacts 或 data/app-deployments。

## 3. 发布和回滚

先运行 GitHub 的 后端镜像发布（Docker / OSS），再把 Actions 摘要中的真实 ID 用于服务器命令：

```sh
bash deploy-release.sh RELEASE_ID --init
```

脚本在临时目录下载归档，验证大小、SHA-256、gzip、OS/架构与镜像身份，执行 docker load，随后删除临时归档。再次导入仍从 OSS 获取并校验，不保留服务器 releases 缓存。

配置检查通过后才停止旧 API；--init 运行迁移并创建缺失的管理员。Compose 只启动 API，默认在 API 内运行任务恢复器，不再启动本地静态资源服务。初始管理员凭据在 data/secrets/bootstrap-admin.txt，首次登录改密后删除。

```sh
docker compose ps
curl -fsS http://127.0.0.1:3000/api/v1/health
docker compose logs --tail 100 api
```

普通升级执行 `bash deploy-release.sh NEW_RELEASE_ID`，不重建管理员。通过健康检查后更新 .env、current-release 和 previous-release；迁移或健康失败不会推进记录，也不会自动回退数据库。失败后须检查容器实际状态，不能只依据记录判断运行版本。

确定数据库与旧代码兼容后，可执行 `bash deploy-release.sh OLD_RELEASE_ID --rollback`。它仍从 OSS 校验、导入镜像，跳过数据库迁移与管理员初始化，只切换后端程序。

## 4. 旧数据与恢复

必须保留与数据库配套的 data/secrets/provider.key。旧本地业务文件使用 [迁移工具](api-environment.md) 先上传、校验 OSS，再更新数据库并删除确认的本地文件。旧子应用版本先确认 OSS 中完整可访问，再删除旧静态目录；不要直接清空尚未核实的数据。

MySQL 和密钥需要配套备份；远端业务文件与应用版本另行保留 OSS 对象备份 / 版本。公开 Bucket 内的数据库备份必须先加密，密钥分开存放。详见 [备份与恢复](operations-and-recovery.md)。

下载或解压失败时清理本次临时目录；SIGKILL、断电或 SSH 不可达可能留下临时残留，恢复后核对再清理。保留当前和可回滚的运行镜像，按运维策略清理旧镜像；不要删除正在运行的数据或密钥。

脚本回归为 pnpm test:api-deployment，使用 Docker / OSS 替身验证实际归档校验、临时目录清理、迁移、失败恢复与回滚；不代表已经完成真实 ECS / OSS 联调。
