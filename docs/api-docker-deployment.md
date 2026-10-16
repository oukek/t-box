# API：GitHub Actions → OSS 镜像包 → 宝塔 Compose

链路：GitHub 源码 → Actions 构建和校验镜像 → docker save + gzip → `tboxos-admin/docker/` 公开目录 → 服务器下载并校验 → docker load → Compose 部署 → 宝塔 Nginx 提供 HTTPS/WSS。当前正式方案使用 PM2，本页仅为可选 Docker 部署。

不需要镜像仓库、docker login 或 docker pull。OSS 保存普通镜像归档文件；Compose 使用已经导入的本地镜像。Actions 不连接生产数据库，也不会自动 SSH 上线。前端和管理后台仍是独立静态站点，MySQL、Redis 继续使用服务器已有实例。

## 构建和脚本

- 仓库根目录是 Docker 构建上下文，Dockerfile 在 api/Dockerfile；不能仅上传 api 目录。
- pnpm build:api 按依赖顺序构建 API 的生产 workspace 包。镜像固定 pnpm 11.18.0，使用 deploy --legacy --prod；包的 files: ["dist"] 保证编译产物被带入独立目录。
- 计算器 Web 产物作为首次安装种子，额外构建；其生产部署需要与宿主不同源的 HTTPS 域名。
- 固定 Node 24.21.0 Debian slim，node 用户 UID/GID 1000；正式运行不需要 pnpm、tsx 或源码。
- .env、oss.env、上传内容、密钥、旧发布产物和服务器下载缓存都不进入镜像构建上下文。
- 当前工作流构建 linux/amd64；服务器执行 uname -m 确认架构。ARM 服务器需要调整工作流 platforms 并增加 QEMU 支持。服务器脚本会按 Docker daemon 的实际架构检查镜像。
- 现有 quality 工作流保持独立；新工作流会先执行部署脚本回归，再构建、检查生产模块、导出和上传。

| 文件 | 用途 |
| --- | --- |
| export-release.sh | CI 导出镜像包、校验文件和 release.json |
| upload-release.sh | 上传 OSS；release.json 最后上传，作为完成标记 |
| download-release.sh | 服务器下载、检查大小/SHA-256/gzip/架构、导入并核对镜像 ID |
| deploy-release.sh | 加锁部署、迁移、等待健康检查、记录当前及上个版本 |
| release-common.sh | 参数、发布清单和归档校验；不能单独运行 |
| compose.yaml | API、应用产物服务和首次应用初始化 |
| .env.example / oss.env.example | API 运行配置 / 独立 OSS 下载配置 |

脚本使用 bash 调用，不要求文件具有执行权限。部署文件直接放在一个目录，脚本会自行定位 compose.yaml、.env、oss.env，不依赖当前工作目录。

## 1. OSS 与 GitHub 配置

复用后台的 `tboxos-admin` Bucket，镜像包放在 `docker/releases/`，不新建私有桶。此目录中的镜像包允许公开下载，包含服务端程序；构建上下文排除真实 `.env`、密钥、上传文件和数据库。后台网页位于同桶根目录，发布网页不会删除 Docker 子目录。

GitHub 仓库 Settings → Secrets and variables → Actions：

| 类型 | 名称 | 示例 / 用途 |
| --- | --- | --- |
| Variable（可选） | ADMIN_OSS_BUCKET | 默认 tboxos-admin，与后台网页共用 |
| Variable | OSS_REGION | cn-hangzhou，Bucket 实际地域 |
| Variable（可选） | OSS_PREFIX | 默认 docker；仅允许字母、数字、_、- 和分段 / |
| Variable（可选） | OSS_ENDPOINT | 默认由 region 生成公网 HTTPS endpoint；GitHub 托管 runner 不使用 ECS 内网地址 |
| Secret | OSS_ACCESS_KEY_ID | 用于上传的 RAM 用户 AccessKey ID |
| Secret | OSS_ACCESS_KEY_SECRET | 对应 Secret |
| Secret（可选） | OSS_SESSION_TOKEN | 使用 STS 临时凭据时提供；必须与 AK 配对且执行时未过期 |

原 OSS_BUCKET、API_REGISTRY、API_IMAGE_NAME 和 Registry 登录 Secrets 不再供 GitHub 工作流使用，可以移除。服务器 oss.env 中的 OSS_BUCKET 是下载脚本配置，保留为 tboxos-admin。

RAM 凭据仅授权目标 Bucket 的 docker/ 前缀。CI 需要 PutObject、PutObjectAcl 及客户端所需的读取/分片相关权限，例如 GetObject、ListParts、AbortMultipartUpload；不要授予整个阿里云账户的管理权限。包是公开读对象；服务器下载脚本沿用 ossutil，可使用只读 RAM 凭据或 ECS RAM 角色。具体权限资源范围应按当前 ossutil 和实际分片行为核对。

工作流名称为 API Docker OSS，仅支持手动 Run workflow；所有工作流均无自动触发。每次生成独立 ID：

```text
sha-完整40位提交SHA-run-GitHub运行编号-attempt-重跑次数
```

即使重跑同一个 commit，目录和本地镜像标签也不同，避免新构建覆盖旧部署版本。不要手动用同一个 release ID 上传不同内容；版本选择以 Actions 摘要中的完整 ID 为准，没有自动 latest 切换。

OSS 文件布局：

```text
oss://tboxos-admin/docker/releases/<RELEASE_ID>/
  image.tar.gz
  image.tar.gz.sha256
  release.json
```

release.json 记录归档 SHA-256、大小、本地镜像标签、Docker image ID、OS/架构与源码信息。先传镜像与校验文件，最后传发布清单；上传失败且没有清单时，服务器不会部署。SHA-256 用于发现传输损坏和文件不一致，不替代 OSS 访问权限或发布签名。

Actions 使用官方 ossutil 2.4.0 安装包，先核对官方 SHA-256 再安装；凭据只通过上传步骤的环境变量传入，不输出到命令行、不写入镜像。无需配置服务器 SSH、数据库或 AI 密钥。

## 2. 准备宝塔服务器

默认针对 Linux **宿主机安装的 Nginx、MySQL、Redis**，Compose 使用 network_mode: host。API 监听 127.0.0.1:3000，应用产物服务监听 127.0.0.1:6176；不发布 ports，也不需要在安全组开放这两个端口。

普通 bridge 网络里的 127.0.0.1 是容器自身，本方案的主机网络允许连接宿主机回环地址。如果数据库或 Nginx 本身在容器内且没有宿主机端口映射，应改用共享 Docker 网络和服务名。相同端口不能同时运行多个 API 实例。

安装/确认以下工具：

- Docker 与 Compose v2.20+（支持 --wait 和多 env-file；建议使用宝塔提供的当前版本）。
- bash、jq、gzip、GNU coreutils（sha256sum、cmp 等）和 util-linux（flock）。
- ossutil 2.x，建议与 Actions 一样使用官方 2.4.0。

Ubuntu 可通过 apt 安装 jq、unzip、coreutils、util-linux；Alibaba Cloud Linux 用 dnf/yum 安装对应软件包。ossutil 安装按末尾官方文档，选服务器架构对应的安装包并校验 SHA-256。不要把未经验证的安装脚本直接混进应用部署步骤。

以部署目录 /www/server/t-box 为例，将仓库 deploy/api/ 中的脚本、compose.yaml、两个 env 示例和 Nginx 示例复制过去。首次准备：

```sh
cd /www/server/t-box
cp .env.example .env
cp oss.env.example oss.env
chmod 600 .env oss.env
mkdir -p data/secrets data/storage data/app-artifacts data/app-deployments
chown -R 1000:1000 data
chmod 700 data/secrets data/storage
docker compose version
```

编辑 .env：

- API_IMAGE 初次保留 t-box-api:not-installed；部署脚本成功后写入实际本地标签。
- MYSQL / REDIS 使用服务器实际地址、账号密码；开发机数据库不会自动变成服务器数据库。
- 建议宝塔预建 t_box 数据库和专用用户，授权该数据库的建表、ALTER 等迁移操作。
- CORS_ORIGINS 替换为真实前端、后台 HTTPS origin。
- APP_ARTIFACT_ORIGIN 使用单独应用资源域名，例如 https://apps.example.com，不能与前端/后台同源。
- TRUSTED_PROXIES 示例适用于宿主机 Nginx 直接代理，其他拓扑填实际可信代理。
- 更改 API_PORT、ARTIFACT_PORT 时，同步更改 Nginx upstream。

密码包含 #、$ 等字符时使用单引号。不要提交真实 .env、oss.env 或上传备份。

编辑 oss.env：OSS_BUCKET=tboxos-admin、OSS_PREFIX=docker，填写实际地域；同地域 ECS 可使用 HTTPS 内网 endpoint。凭据通过部署账户自己的 ossutil profile 配置（ossutil config；配置文件 chmod 600），或通过其环境变量/ECS RAM 角色提供。使用 sudo 时确认实际执行账户的 profile。OSS 凭据不放在 API .env；Compose 也不加载 oss.env 到 API。

oss.env 是运维人员管理的 shell 配置，不接受从 OSS 清单或模型输出生成的脚本内容。数据文件和 Docker 操作都由部署账户执行，账户需要 Docker 权限和部署目录写权限。

## 3. 首次部署 / 迁移已有环境

迁移已有环境时，先备份并恢复同一时点的数据库，以及：

| 旧路径 | 服务器路径 |
| --- | --- |
| api/.secrets | data/secrets |
| api/.storage | data/storage |
| output/app-artifacts | data/app-artifacts |
| apps/<id>/deployment.local.json | data/app-deployments/<id>/deployment.local.json |

设置这些目录 UID/GID 为 1000。必须保留 provider.key，否则数据库里的服务商、支付密钥无法解密。原应用域名改变时需要按应用发布流程调整绑定；初始化不会覆盖已有部署配置。不要公开 .storage 或 .secrets 目录。

用 Actions 摘要中的真实 RELEASE_ID 执行：

```sh
cd /www/server/t-box
bash deploy-release.sh RELEASE_ID --init
```

执行顺序：

1. 获取发布清单与归档，校验大小、SHA-256、gzip 格式和 Docker daemon 架构。
2. docker load 导入；通过 docker image inspect 核对标签、镜像 ID、OS/架构。
3. 检查 Compose 配置，加锁避免并发部署；随后才停止旧 API。
4. --init 初始化计算器的独立应用种子。已有绑定和应用版本保留。
5. 执行 TypeORM 增量迁移，再创建缺失的初始管理员；已有管理员不会重置。
6. Compose 启动 API 和应用产物服务，最多等待 120 秒的健康检查。
7. 成功后更新 .env 中 API_IMAGE，记录 current-release / previous-release。

初始管理员凭据在 data/secrets/bootstrap-admin.txt；首次登录修改密码后删除。文件中的 localhost 地址是开发提示，不适用于服务器。

数据库命令沿用项目的迁移锁和增量迁移，不使用 synchronize。专用账号没有建库权限时，先在宝塔创建数据库。

检查：

```sh
docker compose ps
curl -fsS http://127.0.0.1:3000/api/v1/health
docker compose logs --tail 100 api
```

健康检查以 API 可访问且 MySQL up 为通过条件。Redis down 时是 degraded，仍可读写账单，需从 health 响应检查缓存连接。Docker restart 策略恢复退出的进程，unhealthy 本身不触发自动重启。

也可先下载校验并导入，保持现有 API 继续运行：

```sh
bash download-release.sh RELEASE_ID
```

归档缓存位于 releases/<RELEASE_ID>/。每次使用缓存仍重新校验；缓存损坏时删除该版本的本地缓存后重新下载。未校验成功的临时目录会清理；下载失败或校验失败不执行 docker load，不停止旧应用。

## 4. 宝塔 HTTPS 与 WebSocket

前端和后台各自的宝塔 HTTPS 站点中，参考 nginx-api.conf.example 添加 `location /api/`，代理到 127.0.0.1:3000。保留完整 /api 路径，开启 HTTP/1.1、Upgrade、长连接超时并关闭响应缓冲，兼容 AI 会话和账本实时通知。

如果使用独立 api.example.com 域名，也可在该站点采用同样的 /api/ location，并将前端、后台 API 基址指向该 HTTPS 服务；对应域名仍需正确设置 CORS。

apps.example.com 作为独立 HTTPS 站点，参考 nginx-artifacts.conf.example 将 / 代理到 127.0.0.1:6176。这个域名提供公开的应用代码，不提供用户上传内容。静态服务会验证 manifest 和内容摘要；不要把包含私有 .storage/.secrets 的整个目录公开。

反向代理示例假设 Nginx 直接接收请求，使用 $remote_addr 覆盖 X-Forwarded-For。如果前面还有 CDN，应先在 Nginx 配置可信 real_ip 来源，再评估实际代理链。宝塔已有的 /api/ 配置应合并替换，避免重复 location。

前端和后台生产静态文件分别来自 app/dist、admin/dist，不使用 Vite 开发服务器。微信支付通知 URL、OAuth 回调等仍在后台配置为真实 HTTPS 域名。

## 5. 更新、失败恢复与回滚

升级前备份 MySQL 和 data，使用 Actions 摘要中的新 RELEASE_ID：

```sh
bash deploy-release.sh NEW_RELEASE_ID
```

普通升级执行迁移，不再次执行初始管理员创建和应用种子初始化。Compose 的 pull_policy: never 与脚本的 --pull never 保证不会尝试去 Docker Hub 拉取本地标签。无需 docker compose pull。

迁移失败时停止升级，不启动新 API，不自动回退数据库。健康检查失败时不推进 .env/current-release；新容器可能已经启动，需要检查日志和真实容器状态，不能只凭 .env 判断运行版本。脚本不自动执行财务业务或重新提交 AI 工具。

current-release 记录最近成功部署版本，previous-release 记录其前一成功版本。数据库结构与旧代码兼容、且备份已确认后，可显式只切换代码：

```sh
bash deploy-release.sh OLD_RELEASE_ID --rollback
```

--rollback 仍校验/导入镜像并等待健康检查，跳过迁移、管理员和应用初始化。它不恢复数据库；不兼容迁移需计划数据库恢复或向前修复，不能自动执行 down 迁移。应用发布记录和不可变版本应保留。

需要同时备份 MySQL、data/secrets、data/storage、data/app-artifacts、data/app-deployments；Redis 缓存可重建。持久目录不会随镜像替换删除。默认单实例，不能直接扩容来解决通知和会话订阅问题。

服务器 releases 缓存、Docker 旧镜像、OSS 历史对象都由运维按保留策略清理。保留当前版本、可回滚版本和必要备份；OSS 可配置旧对象及未完成分片的生命周期规则，避免持续累积。不要自动删除 data。

脚本回归：pnpm test:api-deployment。Docker/OSS 命令使用测试替身，SHA-256、gzip、jq 与文件校验是真实操作；涵盖损坏文件、镜像架构/身份、发布顺序、缓存、迁移失败、健康失败和回滚。它不等同于真实 ECS/OSS 联调。

## 官方参考

- [Docker save](https://docs.docker.com/reference/cli/docker/image/save/) / [Docker load](https://docs.docker.com/reference/cli/docker/image/load/)。
- [ossutil 2.x 安装、官方校验和与凭据配置](https://help.aliyun.com/zh/oss/developer-reference/ossutil-overview/)。
- [OSS 文件上传与下载](https://help.aliyun.com/zh/oss/developer-reference/cp/)。
- [pnpm Docker](https://pnpm.io/docker) / [pnpm deploy](https://pnpm.io/cli/deploy)。
- [Docker Compose 服务配置](https://docs.docker.com/reference/compose-file/services/)。
