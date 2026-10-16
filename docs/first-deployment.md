# 首次部署：OSS 网站 + PM2 后端

按下面顺序操作。前端、后台和子应用静态文件均由 OSS 提供；服务器只运行 API、恢复 worker、MySQL 和 Redis。所有 Actions 都手动运行。

## 1. 域名和 OSS

使用同一个主域名的 HTTPS 子域名，例如：

| 域名 | 指向 |
| --- | --- |
| `box.example.com` | 主前端 OSS Bucket |
| `admin.example.com` | 后台 OSS Bucket |
| `apps.example.com` | 子应用 OSS Bucket |
| `api.example.com` | `8.163.69.101` |

后台与 API 必须是同一主域名下的 HTTPS 子域名，浏览器才能可靠使用保留的 `SameSite=Strict` 登录 Cookie。不要使用 OSS 默认桶域名作为后台地址，也不要把后台和 API 分别放到两个无关主域名。

在 OSS 控制台创建三个不同的标准存储 Bucket，允许公开读取静态对象，禁止公开写入。分别启用静态网站托管，默认首页 `index.html`，绑定域名、配置 CNAME 和 HTTPS。子应用站点需要支持子目录首页，例如 `/calculator/<摘要>/` 返回该目录的 `index.html`，不能配置将全部路径重写成同一个首页的 SPA 规则。

另创建一个私有构建 Bucket，供应用版本 JSON 包和可选 Docker 归档使用。公开 Bucket 只保存构建后的网页；私有构建 Bucket 不绑定前端域名。

建议四个 Bucket 使用同一地域。若使用 CDN，遵从对象的 Cache-Control，不缓存后台/API 请求，不改写 JS/HTML。更新主站后刷新 `index.html`、`tbox-offline.js`、`tbox-offline-sw.js`，保留旧摘要资源。发布脚本会先传依赖，再传 HTML、离线 worker 或应用清单，并通过公开 HTTPS 下载逐个核对 SHA-256；域名、证书或访问权限未就绪时发布失败。

OSS 配置见 [静态网站托管](https://help.aliyun.com/zh/oss/user-guide/hosting-static-websites)、[自定义域名 HTTPS](https://help.aliyun.com/zh/oss/user-guide/access-oss-by-https-protocol)。内地服务器和 Bucket 的域名按阿里云要求完成备案。

## 2. GitHub 配置

仓库 Settings → Secrets and variables → Actions。当前工作流没有绑定命名 Environment，配置 Repository Secrets / Variables。

Secrets：

| 名称 | 内容 |
| --- | --- |
| `PM2_SSH_PASSWORD` | 服务器 root SSH 密码 |
| `PM2_SSH_KNOWN_HOSTS` | 从可信服务器控制台获取的主机公钥行 |
| `OSS_ACCESS_KEY_ID` | RAM 上传账号 AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | 对应 Secret |
| `APP_IMPORT_TOKEN` | 后端首次启动后生成，第 5 步再填 |
| `OSS_SESSION_TOKEN` | 可选，仅使用临时 STS 凭据时填写 |

服务器控制台执行，完整输出作为 `PM2_SSH_KNOWN_HOSTS`：

```sh
awk '{print "8.163.69.101 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

Variables：

| 名称 | 示例 / 内容 |
| --- | --- |
| `OSS_REGION` | Bucket 地域，例如 `cn-hangzhou` |
| `WEB_OSS_BUCKET` | 主前端 Bucket 名称 |
| `ADMIN_OSS_BUCKET` | 后台 Bucket 名称 |
| `APPS_OSS_BUCKET` | 子应用 Bucket 名称 |
| `OSS_BUCKET` | 私有构建 Bucket 名称 |
| `WEB_ORIGIN` | `https://box.example.com` |
| `ADMIN_ORIGIN` | `https://admin.example.com` |
| `APP_ARTIFACT_ORIGIN` | `https://apps.example.com` |
| `API_BASE_URL` | `https://api.example.com/api/v1` |
| `OSS_ENDPOINT` | 可选；默认 `https://oss-<OSS_REGION>.aliyuncs.com`，必须使用公网 endpoint |
| `APP_OSS_PREFIX` | 可选，默认 `t-box/apps`；与服务器保持一致 |
| `APP_IMPORT_API_URL` | 可选，默认从 `API_BASE_URL` 拼接 `/application-builds` |

域名来源变量不带结尾 `/`。RAM 仅授权上述 Bucket 的必要对象前缀，上传需要 `oss:PutObject`；私有构建下载签名需要 `oss:GetObject`；私有对象 ACL 需要 `oss:PutObjectAcl`。按 ossutil 实际行为保留分片上传所需的 `oss:ListParts`、`oss:AbortMultipartUpload` 权限。无需阿里云主账号密钥。

## 3. 服务器

准备 Linux x64、Node 24.21.0（最低 24.15）、PM2、MySQL 8.4、Redis，以及 bash/tar/gzip/sha256sum。root 非交互 SSH 中须能找到 node 和 pm2。防火墙放行 SSH 22 和网站 80/443，数据库及 API 本地端口不对公网开放。

创建专用数据库与用户。将 `deploy/pm2/api.env.example` 上传为 `/www/wwwroot/tbox/shared/api.env`，权限 600，填写数据库及 Redis 的实际地址、端口、密码。模板的 Redis 3508 需按实际安装修改。

同时修改：

```dotenv
CORS_ORIGINS=https://box.example.com,capacitor://localhost,http://localhost,https://localhost
ADMIN_ORIGINS=https://admin.example.com
TRUSTED_PROXIES=127.0.0.1,::1
APP_ARTIFACT_ORIGIN=https://apps.example.com
APP_ARTIFACT_DELIVERY=oss
APP_IMPORT_OSS_ORIGIN=https://私有构建Bucket.oss-cn-hangzhou.aliyuncs.com
APP_IMPORT_OSS_PREFIX=t-box/apps
```

`APP_IMPORT_OSS_ORIGIN` 使用私有构建桶的标准公网 HTTPS 域名，不带结尾 `/`，地域与桶一致。服务器不需要保存 OSS AccessKey，下载使用 Actions 生成的签名 URL。

宝塔只为 API 域名配置 HTTPS 站点，添加 `deploy/api/nginx-api.conf.example`，代理 `/api/` 到 127.0.0.1:3000，保留路径、WebSocket、原始通知 JSON 和 Wechatpay-* 请求头。后台 Cookie、登录响应和 API 响应不能经过公共缓存。不要公开部署根目录或 shared。

## 4. 首次运行 Actions

1. 将代码提交到 GitHub 默认分支，先运行 **Quality**，等待通过。
2. 运行 **API PM2 package and upload**，勾选 `start_services`、`initialize_admin`。工作流先上传当前发布包的四个子应用初始静态版本到 OSS，逐文件验证后才 SSH 上传后端、迁移并启动。OSS 模式只启动 `t-box-api`、`t-box-worker`，升级时清理旧本地产物服务。
3. 运行 **Web OSS deployment**，`target=all`，发布主前端和后台。需要单独更新时选择 `app` 或 `admin`。
4. 在服务器读取 `shared/secrets/bootstrap-admin.txt`，打开后台域名登录、修改密码，删除初始凭据文件，再配置服务商和模型。
5. 服务器执行 `pm2 startup` 并按输出完成系统服务配置，再执行 `pm2 save`。

后续发布后端仅勾选 `start_services`。发布工作流目前不自动依赖 Quality，操作员应确认同一提交的 Quality 通过。失败不会自动回滚数据库。首次应用种子已随 PM2 工作流上传，首次打开应用不依赖导入 token。

## 5. 后续更新子应用

在服务器执行：

```sh
cd /www/wwwroot/tbox/current/api
node dist/application-platform/import-credential-cli.js create admin calculator,calendar,ledger,time 90
```

命令生成 `shared/secrets/app-build-<凭证ID>.txt`，将内容填入 GitHub Secret `APP_IMPORT_TOKEN`。默认有效 90 天，到期前轮换。

运行 **Application OSS submission**，选择应用和未用过的版本号。工作流先将摘要目录的静态文件发布到公开子应用 Bucket，再上传私有 JSON 包、登记待发布版本。最后进入后台“应用发布”审核上架。OSS 模式隐藏后台本地 dist 上传入口，避免登记出无法从 OSS 访问的页面。

服务器仍保留经过校验的应用产物副本，供版本校验、备份和恢复使用；用户访问由 OSS 提供。后端能力变更先发布 API，再发布应用版本。设置和市场随主前端更新。

## 6. 微信配置

先完成网站和 API 上线，再配置真实支付。当前已实现微信支付及支付订单所需的服务号网页授权；未实现服务号模板消息、客服消息、关注事件接收或通用微信一键登录。站内任务通知不等于服务号推送。

先登录微信公众平台，找到服务号的开发者信息/基本配置，取得服务号 AppID 和 AppSecret；再登录微信支付商户平台，准备商户号与 API v3 凭据，并将商户号关联到对应 AppID。移动应用 AppID 来自微信开放平台，与服务号 AppID 分别填写。

打开项目后台“支付订单 → 微信支付配置”，逐项填写：

| 后台字段 | 从哪里取得 | 当前用途 |
| --- | --- | --- |
| 服务号 AppID | 微信公众平台对应服务号的 AppID | 网页 Native/H5/JSAPI 下单身份；不要填移动应用 AppID |
| 服务号 AppSecret | 同一服务号的开发者密钥 | JSAPI 支付前网页授权换取 openid；开启 JSAPI 时必须填写 |
| 移动应用 AppID | 微信开放平台的移动应用 | 仅原生 APP 支付；与原生壳公开配置一致 |
| 商户号 | 微信支付商户平台 | 收款商户身份 |
| 商户 API 证书序列号 | 商户 API 证书 | 标识商户签名证书 |
| 商户 API 私钥 PEM | 与该商户证书配套的私钥 | 签名支付、退款和查单请求 |
| API v3 密钥 | 商户平台设置的 32 字节 API v3 密钥 | 解密支付/退款通知；不是服务号 AppSecret，也不是消息 EncodingAESKey |
| 微信支付公钥 ID / 平台证书序列号 | 商户平台对应的微信支付公钥或平台证书 | 标识受信任的微信验签公钥 |
| 微信支付公钥 / 平台证书 PEM | 与上项 ID 配套的公钥或证书 | 验证微信支付响应、通知签名 |

AppSecret、商户私钥和 API v3 密钥只填写在项目后台，加密保存到服务器数据库，不放到 OSS、前端环境变量或 GitHub 构建 Secrets。已有密钥留空会保留，不需要每次部署重复填写；保存后接口只返回是否已配置。`shared/secrets/provider.key` 与数据库一起备份。仅做 APP 支付且关闭全部网页渠道时，可以不填写服务号 AppID/AppSecret。

随后配置域名与支付开关：

| 配置位置 | 填写内容 |
| --- | --- |
| 项目后台：API 公网地址 | `https://api.example.com`，不含 `/api/v1` |
| 项目后台：支付网页地址 | `https://box.example.com`，不带 `#` 路由 |
| 微信商户平台：H5 支付域名 | `box.example.com`，不带协议 |
| 微信商户平台：JSAPI 支付授权目录 | `https://box.example.com/`，包含协议和末尾 `/` |
| 微信公众平台：网页授权域名 | `api.example.com`，因为 OAuth 回调在 API 域名 |
| 支付通知 | `https://api.example.com/api/v1/payments/webhooks/wechat` |
| 退款通知 | `https://api.example.com/api/v1/payments/webhooks/wechat/refunds` |
| 网页授权回调 | `https://api.example.com/api/v1/payments/wechat/oauth/callback` |

公众号提供的 API 域名验证 `MP_verify_*.txt` 放到服务器 `shared/wechat/`，示例 Nginx 已提供对应根路径读取。若验证的是主站域名，放入 `app/public/` 后重新发布主站；后台域名验证文件放入 `admin/public/`。都要通过真实 HTTPS 根路径访问到原始文件，不能返回首页或重定向。

如果发布 Android/iOS，另在微信开放平台绑定真实包名/Bundle ID、Android 发布签名和 iOS Universal Link。填写 `capacitor/wechat.config.json` 的公开身份，推荐 Universal Link 为 `https://box.example.com/wechat/`。启用后主站 OSS 发布会自动生成、合并并上传 `/.well-known/apple-app-site-association`，类型 application/json。原生壳仍需执行 `pnpm native:sync`，重新签名打包。

Native 是 PC 扫码，APP 才是原生支付；当前 iOS 原生 AI 余额充值仍禁用。网页支付和 Android APP 支付需分别开通相应产品，最后用真机、小额订单核对付款与到账。详见 [计费与支付](billing-and-payments.md)、[原生微信](wechat-native-payments.md)及微信官方 [JSAPI 目录](https://pay.wechatpay.cn/doc/v3/merchant/4013287088)、[H5 域名](https://pay.wechatpay.cn/doc/v3/merchant/4013287193)。

### 服务号消息：尚未接入，不能只填密钥启用

项目当前只有站内任务通知和设备本地提醒，未提供服务号消息配置页、公众号消息接收 URL、接口 access_token 管理或消息发送队列。因此当前部署不要臆造 WECHAT_TOKEN 等环境变量，也不要把支付通知 URL 填进公众号“服务器配置”。

未来接入服务号消息时，需要明确以下配置及功能：

| 项目 | 用途与位置 | 当前状态 |
| --- | --- | --- |
| 服务号 AppID / AppSecret | 后端获取公众号接口调用凭据；可使用同一服务号身份，但当前支付配置不会自动启用消息发送 | 仅支付网页授权已使用，消息通道未接入 |
| 接口 access_token | 后端取得并缓存、刷新，用于调用消息接口；不同于网页授权 access_token | 未实现，不应让操作员手填长期值 |
| 接收 URL、Token | 公众号服务器配置与后端接收端一致，用于接收消息/事件并校验来源 | 未实现，当前没有可填写的项目回调地址 |
| EncodingAESKey | 公众号消息安全模式的加解密密钥，与 API v3 支付密钥分开 | 未实现，无后台配置入口 |
| 消息模板 ID / 字段映射 | 在公众号申请对应权限和模板，后端将业务事件映射到模板字段 | 未实现 |
| 用户 openid、绑定及授权状态 | 确认给哪个已绑定用户发送，并遵循账号能力和消息场景要求 | 目前只有支付授权用途，未实现消息通道绑定 |
| IP 白名单 | 涉及公众号接口调用时，按平台要求填写服务器实际公网出口 IP | 消息通道接入时核对；不能直接假定 SSH 入口 IP 就是出口 IP |

“支付成功通知”是微信支付通知后端核对订单，“服务号消息发送”是项目向用户发消息，两者不是同一条链路。后者需要补完通道实现和联调，不能因支付已配置就宣称已经可用。能力与参数参考 [腾讯云官方公众号 API 清单](https://cloud.tencent.com/document/product/1301/100187)和 [微信消息接入说明](https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Access_Overview.html)。

## 验证范围

`pnpm check`、`pnpm build`、`pnpm test:unit`、`pnpm test:operations`、部署脚本回归、隔离 MySQL 集成测试及桌面/移动 Chromium 后台跨来源登录验收。OSS/SSH 测试使用本地替身；测试不向生产服务器、真实 Bucket 或微信商户发送写请求。
