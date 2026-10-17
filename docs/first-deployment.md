# 首次部署：按顺序操作

当前方案：主前端、后台、子应用和业务文件都放 OSS；后端使用 Actions 构建包上传服务器，再由 PM2 启动。服务器保留后端程序、数据库、配置、密钥和必要日志，业务文件不长期落盘。全部 Actions 手动运行。

下文的 `example.com` 换成你的真实主域名，OSS 地域换成三个 Bucket 的实际地域。GitHub 只填写主域名和地域两个普通变量；Bucket、子域名、发布目录和 API 路径统一由 [部署设置脚本](../deploy/settings.mjs) 生成。

**所有需要填写的配置一次列齐：**

| 配置位置 | 要填写的内容 |
| --- | --- |
| GitHub Repository Variables | `DEPLOY_DOMAIN`、`OSS_REGION` |
| GitHub Repository Secrets | `PM2_SSH_PASSWORD`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`APP_IMPORT_TOKEN` |
| 服务器 `/www/wwwroot/tbox/shared/api.env` | `MYSQL_HOST`、`MYSQL_USERNAME`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、服务器上传账号的 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`；`REDIS_ADDR=` 保持空即可不用 Redis |
| OSS / DNS / Nginx | 三个公开读 Bucket、四个 HTTPS 域名、网站托管、跨域及 API 反向代理，见第 1、3 步 |
| 项目后台 AI 配置 | 服务商 API 地址、API Key、实际可用模型 |
| 微信平台及项目后台支付配置 | 服务号 AppID / AppSecret、商户号、商户证书序列号 / 私钥、API v3 密钥、微信支付公钥 ID / PEM（或平台证书）、API 与支付网页地址、商品描述、支付渠道和充值开关；域名授权见第 6 步 |
| 发布原生 Android / iOS 时 | 移动应用 AppID、包名 / Bundle ID、签名、Universal Link、Apple Team ID，见第 6 步 |

GitHub 配置现在就全部填好。`APP_IMPORT_TOKEN` 由你设置一个 32–128 位、仅含英文字母 / 数字 / `_` / `-` 的随机字符串，推荐密码管理器生成 64 位；后端部署自动同步其哈希，不再执行生成命令，也没有 90 天到期要求。服务器不手填这个 Token。

## 1. 先配置 OSS 和域名

创建三个标准存储 Bucket，建议使用同一地域，并准备四个 HTTPS 域名：

| 域名示例 | 指向 | 存放内容 |
| --- | --- | --- |
| `box.example.com` | `tboxos` | 主前端；用户文件、AI 图片、记账附件等放 `uploads/resources/` |
| `admin.example.com` | `tboxos-admin` | 管理后台；可选 Docker 包放 `docker/releases/` |
| `apps.example.com` | `tboxos-app` | 子应用静态文件；构建 JSON 包放 `builds/` |
| `api.example.com` | A 记录指向 `8.163.69.101` | 服务器上的 API |

后台与 API 使用同一主域名下的 HTTPS 子域名，这是后台 Cookie 登录的要求。三个 OSS 网站必须绑定自定义域名，不能直接用默认 Bucket 域名浏览网页。中国内地 Bucket 的自定义域名按阿里云要求完成备案。[阿里云说明](https://help.aliyun.com/zh/oss/user-guide/hosting-static-websites)

在 OSS 控制台依次设置：

1. 三个 Bucket 均设置为**公共读，禁止公共写**；如果无法开启公共读，检查并关闭 OSS 全局和对应 Bucket 的“阻止公共访问”。[公共访问开关](https://help.aliyun.com/zh/oss/user-guide/block-public-access/)
2. 三个 Bucket 启用静态网站托管，默认首页填 `index.html`；`tboxos-app` 另外**开通子目录首页**，文件 404 规则选 `NoSuchKey`，不要把所有路径重写到根首页。
3. 分别绑定上述三个网站域名，按 OSS 提示配置 CNAME，并配置有效的 HTTPS 证书。[HTTPS 配置](https://help.aliyun.com/zh/oss/user-guide/access-oss-by-https-protocol)
4. 三个 Bucket 的跨域规则统一设为：来源 `*`；方法 `GET`、`HEAD`；允许 Headers `*`；暴露 Headers `Content-Type`、`Content-Length`、`Content-Disposition`、`ETag`；不携带凭据。[跨域配置](https://help.aliyun.com/zh/oss/user-guide/configure-cross-origin-resource-sharing)

文件地址公开可读，上传和删除仍由后端校验登录权限。业务文件数据库只存相对路径，前端自动拼接标准 OSS 公网域名；不用配置 CDN、下载签名或私有 Bucket。不要清空整桶发布网站，也不要给 `uploads/resources/` 设置自动过期删除。

在阿里云 RAM 创建两个 AccessKey 账号，授权如下，下一步分别填到 GitHub 和服务器：

| 账号用途 | 对象范围 | 权限 |
| --- | --- | --- |
| GitHub 发布 | `acs:oss:*:*:tboxos/*`、`acs:oss:*:*:tboxos-admin/*`、`acs:oss:*:*:tboxos-app/*` | `oss:PutObject`、`oss:PutObjectAcl`；ossutil 分片上传另需 `oss:ListParts`、`oss:AbortMultipartUpload` |
| 服务器业务上传 | `acs:oss:*:*:tboxos/uploads/resources/*` | `oss:PutObject`、`oss:PutObjectAcl`、`oss:GetObject`、`oss:DeleteObject` |

## 2. 再配置 GitHub

进入仓库 **Settings → Secrets and variables → Actions**，添加 **Repository** 配置。当前 Actions 没有绑定命名 Environment，不能只填在 Environment Secrets 里。

**全部 4 个 Secrets 一次填好：**

| 名称 | 填什么 |
| --- | --- |
| `PM2_SSH_PASSWORD` | `8.163.69.101` 的 root SSH 密码 |
| `OSS_ACCESS_KEY_ID` | GitHub 发布 RAM 账号的 AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | 该账号对应的 Secret |
| `APP_IMPORT_TOKEN` | 你设置的长期应用提交凭证：32–128 位随机字母 / 数字 / `_` / `-`；推荐 64 位，后端与应用发布共用此 Secret |

后端 Actions 会在 runner 计算 SHA-256，只通过 SSH 上传哈希，自动在数据库登记当前应用范围及启用的管理员身份，不设置自动到期。原始 Token 不上传 OSS、不进入可下载的后端包，也不写入服务器 `.env`。以后若需要更换，修改这个 GitHub Secret 并重新部署后端，旧的托管凭证自动撤销；子应用发布直接使用同一 Secret。

当前按部署要求暂时关闭 SSH 主机公钥校验，无需配置 `PM2_SSH_KNOWN_HOSTS`，已配置的旧 Secret 可以删除。SSH 登录仍使用密码或私钥认证。

**只需填写 2 个 Variables：**

```dotenv
DEPLOY_DOMAIN=example.com
OSS_REGION=cn-hangzhou
```

`DEPLOY_DOMAIN` 只填小写主域名，不带协议、端口、路径或结尾 `/`；`OSS_REGION` 填三个 Bucket 的实际地域，不带 `oss-`。地域未知时不能随意写死，必须与实际 Bucket 一致。

脚本固定使用 `tboxos`、`tboxos-admin`、`tboxos-app`，自动生成 `box/admin/apps/api.<主域名>` 四个 HTTPS 来源、API `/api/v1` 和导入接口、OSS 公网 endpoint，以及 `builds/`、`docker/` 目录。所有发布 Actions 共用同一设置，不再逐个配置地址和 Bucket。

原来配置的各站点 URL、Bucket、endpoint、发布目录等 GitHub Variables 已不再读取，可以删除；Actions 使用长期 RAM AccessKey，已移除 `OSS_SESSION_TOKEN`。如需不同的子域名前缀或目录，只修改 `deploy/settings.mjs`，再准备匹配的 DNS / OSS 绑定并重新发布。

SSH 地址 `8.163.69.101`、端口 `22`、用户 `root`、部署目录 `/www/wwwroot/tbox` 已写入 PM2 工作流，无须增加变量。

## 3. 准备服务器

1. 安装 Linux x64 环境、Node **24.21.0**（最低 24.15）、PM2、MySQL **8.4**、Nginx，以及 bash、tar、gzip、sha256sum。PM2 可通过 `npm install -g pm2` 安装；确认 root 非交互 SSH 中也能执行 `node -v` 和 `pm2 -v`。
2. 创建 MySQL 数据库 `t_box` 和专用用户 `t_box`，授予该数据库的建表、迁移和读写权限；数据库字符集使用 `utf8mb4`。
3. 创建 `/www/wwwroot/tbox/shared/api.env`，内容如下，替换真实密码和服务器 RAM 密钥，文件权限设为 `600`：

```dotenv
MYSQL_HOST=127.0.0.1:3306
MYSQL_USERNAME=t_box
MYSQL_PASSWORD='替换为实际MySQL密码'
MYSQL_DATABASE=t_box
OSS_ACCESS_KEY_ID=替换为服务器RAM账号的AccessKeyID
OSS_ACCESS_KEY_SECRET=替换为该账号的Secret
REDIS_ADDR=
```

这是此方案完整的必填服务器配置。`MYSQL_HOST` 同时包含地址和端口。**服务器必须单独填写 OSS 密钥，GitHub Secrets 不会自动传给 API。** 地域、Bucket 和应用地址由 Actions 发布包自动提供。

Redis 可选：不使用就保持 `REDIS_ADDR=`；使用时安装 Redis，填 `REDIS_ADDR=127.0.0.1:6379`、实际 `REDIS_PASSWORD` 和选用的 `REDIS_DB`（模板为 `5`）。配置模板见 [api.env.example](../deploy/pm2/api.env.example)，高级覆盖项见 [API 环境配置](api-environment.md)。

4. 为 `api.example.com` 创建 Nginx HTTPS 站点，将 [Nginx 示例](../deploy/api/nginx-api.conf.example) 的 `/api/` 配置放进 `server {}`，代理到 `127.0.0.1:3000`，保留 `/api/` 路径和 WebSocket。API 和登录响应不设置公共缓存；不要将部署目录或 `shared` 目录设为网站公开根目录。
5. 安全组和防火墙放行 `22`、`80`、`443`。MySQL、Redis、API 仅在本机监听。

不需要手填 `CORS_ORIGINS`、`ADMIN_ORIGINS`、`TRUSTED_PROXIES`、`TASK_WORKER_MODE` 或 `APP_ARTIFACT_DELIVERY`：当前方案自动处理跨域、本机代理、独立 worker 和 OSS 交付。

## 4. 运行 Actions

先将当前代码提交、推送到 GitHub 默认分支，再在 **Actions → 对应工作流 → Run workflow** 操作。项目尚未上线时，建议三个工作流选择同一分支 / 提交并按下列顺序验收：

1. **Quality**：等待检查和测试通过。发布工作流目前不会自动等待 Quality。
2. **API PM2 package and upload**：保持 `start_services` 勾选。它会先上传四个子应用初始版本到 OSS，再上传后端包、执行数据库迁移、自动确保管理员存在、同步应用提交凭证、启动 PM2 并检查健康状态。已有管理员不会被重置，服务器不需要拉 Git 仓库或重新构建。
3. **Web OSS deployment**：`target` 选 `all`，发布主前端和后台。

四个初始应用随流程准备好；每次后端发布都自动同步 GitHub 中配置的同一个 `APP_IMPORT_TOKEN`，无需增加配置或手工生成凭证。取消 `start_services` 仅上传时，哈希作为运行配置保存，手动启动该版本时再自动登记到数据库。

日常更新可单独运行对应工作流：主前端选 Web 的 `app`，后台选 `admin`，两者选 `all`，后端只跑 PM2。已有子应用直接运行 Application 工作流。首次接入、修改 Token、新增应用授权，或应用依赖新接口 / 数据库结构时，才需要先部署后端；Quality 独立运行，没有强制串行依赖。

## 5. 登录后台并验收

服务器执行：

```sh
cat /www/wwwroot/tbox/shared/secrets/bootstrap-admin.txt
```

打开 `https://admin.example.com`，用文件中的账号密码登录，立即修改密码，再删除这个初始凭据文件。在后台配置 AI 服务商的 API 地址、API Key 和实际可用模型；启用 AI 功能需要这些配置，服务器不用另外填写 AI 环境变量。

随后执行 `pm2 startup`，按输出完成开机启动设置，再执行 `pm2 save`。首次启动自动生成的 `/www/wwwroot/tbox/shared/secrets/provider.key` 必须保留并与数据库一起备份，它用于解密 AI 和微信密钥，不是临时文件。

最后检查：

- `https://api.example.com/api/v1/health` 返回健康状态，`pm2 status` 中 `t-box-api`、`t-box-worker` 均为 online。
- 主站正常登录，后台登录成功，四个初始子应用可以打开。
- 上传一张图片、添加一笔带附件的记账，刷新后还能查看；OSS 的 `tboxos/uploads/resources/` 出现对应文件。

## 6. 微信配置

网站可以先上线；需要充值支付时，继续完成下面配置。**微信凭据在项目后台填写，不是服务器环境变量，也不是 GitHub Secrets。**

### 先在微信平台准备

1. 微信公众平台：准备具备对应网页授权 / 支付权限的服务号，取得 **AppID、AppSecret**。
2. 微信支付商户平台：将商户号关联到该 AppID，按需开通 Native（PC 扫码）、H5（手机浏览器）、JSAPI（微信内）支付，准备下表中的证书和密钥。
3. 配置域名：

| 配置位置 | 填写示例 |
| --- | --- |
| 公众平台：网页授权域名，启用 JSAPI 时配置 | `api.example.com`，回调在 API 域名 |
| 商户平台：H5 支付域名，启用 H5 时配置 | `box.example.com`，不带协议 |
| 商户平台：JSAPI 支付授权目录，启用 JSAPI 时配置 | `https://box.example.com/`，带末尾 `/` |

H5 域名可能需要审核，先完成对应产品开通和域名配置，再开启项目中的渠道。[H5 配置](https://pay.wechatpay.cn/doc/v3/merchant/4013287193)、[JSAPI 目录配置](https://pay.wechatpay.cn/doc/v3/merchant/4013287088)

公众号要求验证 API 域名时，在 API 的 Nginx `server {}` 中启用示例里的精确匹配验证配置，替换微信提供的 `MP_verify_*.txt` 文件名和原始内容，由 Nginx 直接返回，无须另存服务器文件。验证主站域名的文件放到 `app/public/`，验证后台域名的文件放到 `admin/public/`，然后重新发布对应网站，文件会进入 OSS。验证地址必须返回原始内容，不能是首页或重定向。

### 再填写项目后台

进入 **支付订单 → 微信支付配置**：

| 后台字段 | 填什么 |
| --- | --- |
| 服务号 AppID | 微信公众平台的 AppID，网页支付必填 |
| 服务号 AppSecret | 同一服务号的 AppSecret，JSAPI 必填 |
| 商户号 | 微信支付商户号 |
| 商户 API 证书序列号 | 商户 API 证书对应序列号 |
| 商户 API 私钥 PEM | 与该商户 API 证书配套的私钥 |
| API v3 密钥 | 商户平台配置的 32 字节密钥 |
| 微信支付公钥 ID / 平台证书序列号 | 当前商户使用的微信支付公钥 ID，或平台证书序列号 |
| 微信支付公钥 / 平台证书 PEM | 与上项匹配的微信公钥 PEM，或平台证书 PEM |
| API 公网地址 | `https://api.example.com`，这里**不带** `/api/v1` |
| 支付网页地址 | `https://box.example.com`，不带路径或 `#` |
| 商品描述 | 例如 `T Box 服务余额充值`，不能为空 |
| 支付渠道、开放充值 | 只启用商户已开通的渠道；核对配置后开放充值 |

支付通知和退款通知地址由后台根据 API 公网地址自动生成；保证公网可达即可，无需增加环境变量：

```text
支付通知：https://api.example.com/api/v1/payments/webhooks/wechat
退款通知：https://api.example.com/api/v1/payments/webhooks/wechat/refunds
网页授权回调：https://api.example.com/api/v1/payments/wechat/oauth/callback
```

私钥、API v3 密钥和 AppSecret 加密入库，不上传到 OSS；已有密钥留空会保留。最后用真实设备和一笔小额订单核对付款、到账及订单状态，详见 [计费与支付](billing-and-payments.md)。

**仅发布网页可以跳过原生配置。** 发布 Android / iOS 时，另在微信开放平台创建移动应用，绑定真实包名 / Bundle ID、Android 发布签名和 iOS Universal Link。填写 `capacitor/wechat.config.json`：`enabled=true`、移动应用 `appId`、`universalLink=https://box.example.com/wechat/` 和 Apple Team ID `iosTeamId`；当前启用校验要求四项齐全，Universal Link 必须使用生成的主站域名。在后台填写移动应用 AppID 并启用已开通的 APP 支付，然后重新发布主站生成 AASA 文件，执行 `pnpm native:sync` 并重新签名打包。移动应用 AppID 与服务号 AppID 分开使用；当前 iOS 原生 AI 余额充值禁用，详见 [原生微信配置](wechat-native-payments.md)。

**服务号消息发送尚未接入。** 当前 AppSecret 仅用于支付网页授权；消息 Token、EncodingAESKey、模板 ID、消息接收 URL 没有可用配置入口。不要添加虚构的 `WECHAT_*` 环境变量，也不要把支付通知地址填成公众号“服务器配置”。要发服务号消息，需要另外实现消息通道。

## 发布子应用

在代码中修改目标应用的 `manifest.version` 并提交，然后运行 **Application OSS submission**，只选中文应用名称即可，版本号自动读取；成功后进入后台“应用发布”→“编辑更新信息”填写更新说明和提示，保存后审核上架。后端与凭证已就绪时，无需重复运行后端 Actions。无需补填配置、执行服务器命令或新建 Bucket。若改变主域名、地域或 `deploy/settings.mjs` 中的公共设置，先准备好对应的 OSS / DNS 配置并重新发布后端，再提交应用；已有业务文件不会因改 Bucket 而自动迁移。其他进阶操作见 [PM2 部署](api-pm2-deployment.md)、[子应用发布](application-actions-release.md)、[运维与恢复](operations-and-recovery.md)。
