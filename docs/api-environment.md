# API 高级环境配置

本地配置 MySQL 和可选 Redis，文件默认落本地。生产另外填写业务文件 OSS 的 AccessKey ID / Secret，使用 `deploy/pm2/api.env.example`。地域和 Bucket 由 Actions 发布包自动提供；下面保留全部可选覆盖项。

API 先读取进程环境，再读取 `api/.env`；进程环境优先。PM2 的 `api/.env` 链接到服务器 `shared/api.env`。应用配置按“环境变量 → 已校验发布包的 release-info.json → 本地默认值”读取。修改配置后重启对应 API / worker。

| 变量 | 默认值或自动来源 | 何时需要手填 |
| --- | --- | --- |
| `MYSQL_HOST` | `127.0.0.1:3306` | 数据库地址与端口不同时 |
| `MYSQL_USERNAME` | `root`；生产模板使用 `t_box` | 实际数据库用户名 |
| `MYSQL_PASSWORD` | 空 | 实际数据库密码 |
| `MYSQL_DATABASE` | `t_box` | 实际数据库名 |
| `REDIS_ADDR` | 未设置时禁用 Redis | 使用 Redis 时填 `host:port`，不使用时留空 |
| `REDIS_PASSWORD` | 空 | Redis 设置了密码时 |
| `REDIS_DB` | `0`；模板沿用 `5` | 选择 Redis 逻辑库时，范围 0–15 |
| `OSS_ACCESS_KEY_ID` | 无；生产必填，后端上传用户文件、AI 图片及记账附件 / 分类图标 | 服务器专用 RAM AccessKey ID；只填 GitHub Secrets 不会提供给 API |
| `OSS_ACCESS_KEY_SECRET` | 无；生产必填 | 上述 RAM 用户对应的 Secret |
| `OSS_REGION` | PM2 Actions 包内的 GitHub `OSS_REGION` | 源码 / Docker 生产部署或本地连接 OSS 时填 `cn-hangzhou` 等实际地域 |
| `OSS_RESOURCE_BUCKET` | PM2 Actions 在 `deploy/settings.mjs` 固定使用 `tboxos`；其余默认同名 | 只有改变业务文件 Bucket 时才覆盖，已有对象不能靠改变量迁移 |
| `OSS_SESSION_TOKEN` | 无 | 使用临时 STS 凭据时；过期前必须更新，当前不提供自动续期 |
| `HOST` | `127.0.0.1` | 修改 API 监听地址时 |
| `PORT` | `3000` | 修改 API 端口时，同时调整 Nginx |
| `NODE_ENV` | 本地未设置；PM2 / Compose 注入 `production` | 手动启动生产 API 时必须设为 `production` |
| `CORS_ORIGINS` | `*`，普通 HTTP 与三个 WebSocket 入口来源均放开 | 如需限制来源，填写完整来源并用逗号分隔 |
| `ADMIN_ORIGINS` | `*`，后台回显来源并允许 Cookie | 如需限制后台来源，填写完整 HTTPS 来源并用逗号分隔 |
| `TRUSTED_PROXIES` | `127.0.0.1,::1` | Nginx 未从回环地址连接时，填写实际 IP / CIDR；留空禁用代理头信任 |
| `TASK_WORKER_MODE` | 本地 `embedded`；PM2 自动注入 `external` 并运行独立 worker | 手动拆分 worker 或恢复演练时 |
| `APP_ARTIFACT_DELIVERY` | 生产固定使用 `oss`，生产显式设为 `local` 会拒绝启动；本地开发默认 `local` | 仅开发调试切换交付方式时 |
| `APP_ARTIFACT_ORIGIN` | Actions 包内的应用域名；本地 `http://localhost:6176` | 源码或可选 Docker 手工部署时，需要独立 HTTPS 应用域名 |
| `APP_IMPORT_OSS_ORIGIN` | Actions 按实际地域和固定 `tboxos-app` 写入标准公网桶地址 | 非 Actions 部署需要独立应用导入时；显式留空可禁用导入 |
| `APP_IMPORT_OSS_PREFIX` | Actions 在 `deploy/settings.mjs` 固定为 `builds` | 非 Actions 部署自定义构建包目录时 |

普通 HTTP 开放跨域时不启用 Cookie 凭据；后台必须回显具体来源，不能将 `Access-Control-Allow-Origin: *` 与 Cookie 凭据一起使用。后台来源开放会允许更多网页发起携带凭据的请求，后台仍校验会话和管理请求头。`HttpOnly`、生产 `Secure` 和 `SameSite=Strict` Cookie 保留，因此后台与 API 仍需使用同一主域名下的 HTTPS 子域名；开放 CORS 不会改变浏览器的 Cookie 规则。

显式配置来源列表时不带路径或结尾 `/`；`CORS_ORIGINS=` / `ADMIN_ORIGINS=` 表示空列表，直接删除变量才恢复默认开放。已有配置如保留旧的来源列表或应用地址，会继续按其显式值生效；希望免配置时删除这些行。

`SameSite=Strict` 不隔离同主域的子应用；后台来源开放后，同站子应用也能发起携带管理员 Cookie 的请求。如果之后需要接入不可信的应用代码，应使用 `ADMIN_ORIGINS` 限定后台来源。

PM2 Actions 自动打包应用公开配置，不包含数据库密码或 OSS AccessKey。GitHub 普通变量只需 `DEPLOY_DOMAIN`、`OSS_REGION`，其余由 `deploy/settings.mjs` 生成。初始应用资源依旧先上传、逐文件校验，再启动后端；应用构建导入仍限制到包内指定的 OSS 桶、版本目录和 SHA-256，不允许任意网址下载。若已有环境显式设置的应用地址/模式与发布包不一致，部署在停止旧服务之前拒绝继续。改变主域名、地域或脚本中的公共设置后，先重新发布后端包，再提交子应用版本。

`TASK_WORKER_MODE=disabled` 仅关闭 API 内置恢复器，不会停止独立 worker。源码部署缺少 Actions 元信息时，需要手填应用地址及所需的导入配置。可选 Docker 的 `API_IMAGE`、`API_PORT`、`ARTIFACT_PORT` 是部署工具参数，使用其独立模板。

生产业务文件统一保存到 `tboxos/uploads/resources/<UUID>`，新文件不再落服务器磁盘，分类图标也不再把图片二进制写进 MySQL。资源表 `object_path` 只存相对路径，另记不可变的物理 Bucket 标识；数据库不存 OSS 域名、CDN 域名、服务商临时地址或下载签名。前端读取一次无需登录的 `/api/v1/resources/storage` 获取标准 OSS 域名，直接与相对路径拼接预览 / 下载，不申请下载授权或签名。OSS 请求不携带 API Bearer Token、Cookie 或 Referer。只有资源 ID 的旧引用会先读取资源元信息，本地开发的旧文件仍通过 API 内容接口读取。隔离子应用和账本附件保留现有鉴权桥接接口，由后端从 OSS 读取，不把宿主登录凭据交给子应用。

三个 Bucket 及业务文件均使用公开读，新上传对象显式设置 `public-read`，禁止公开写。任何拿到对象地址的人都能直接读取，包括用户图片和账单附件；资源列表、上传、删除及账本业务接口仍校验登录和业务权限，这些检查不会限制公开链接。业务目录不要设置过期删除的生命周期规则，也不要用整桶清空方式发布网站。生产缺少上传凭据会拒绝启动，且不再注册本地文件后端；本地旧资源必须先迁往 OSS。只有本地开发未填 OSS 时继续使用本地目录。

应用文件同样只保存在 `tboxos-app`，导入和运行校验直接通过 OSS 完成，不写 `output/app-artifacts`，不创建生产 `.storage`、`shared/storage`、`shared/app-artifacts` 或 `shared/app-deployments`。API 包内 `bootstrap-applications.json` 仅保存初始版本摘要，是后端运行配置。服务器保留后端程序、配置、密钥及必要日志；业务附件、应用静态文件和备份归档均不在服务器长期保存。临时下载 / 解压 / 备份目录成功或失败后清理；断电和 SIGKILL 需要运维清理临时目录残留。

旧版已有本地资源时，先停止业务写入，备份数据库与旧目录，再用新发布包迁移：`node current/api/dist/resources/migrate-local.js /www/wwwroot/tbox/shared/storage/resources`。工具逐个上传、读取 OSS 校验字节、更新数据库，最后删除确认已迁移的本地文件；失败保留原件，重跑可继续清理。旧分类图标 BLOB 也会转存 OSS。旧应用产物必须确认在 OSS 完整存在后再删除，不能直接把含未备份数据的旧目录整批清空。

如果曾用旧版本真实上传过私有对象，需在 OSS 控制台选中 `tboxos/uploads/resources/` 内的旧文件，批量将对象读写权限改为“公共读”。只改 Bucket 权限不会覆盖对象自己的私有 ACL。当前修改只改变后续上传行为，不会未经连接就修改云端历史对象。

服务器 RAM 账号只需对 `acs:oss:*:*:tboxos/uploads/resources/*` 授予 `oss:PutObject`、`oss:PutObjectAcl`、`oss:GetObject`、`oss:DeleteObject`；无需整桶写权限。配置步骤见 [首次部署](first-deployment.md)。这些服务器凭据不会放入 Actions 构建包；GitHub 的上传账号负责静态发布，两个账号可分别授权。

微信 AppID、AppSecret、商户号、API v3 密钥和商户私钥在项目后台的微信支付配置填写；AI 服务商和模型也由后台管理。Actions 上传凭据和长期 `APP_IMPORT_TOKEN` 在 GitHub 一次配置好；PM2 部署自动同步 Token 的哈希到服务器和数据库，无需在 API 环境变量重复填写，也没有 90 天续期要求。加密主密钥首次启动自动创建，PM2 持久化到 `shared/secrets/provider.key`，须与数据库一起备份。公众号消息发送尚未接入，添加环境变量不会启用它。
