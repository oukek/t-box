# 现有网页版首次上线 PWA 和 macOS 桌面版

现有网页版继续使用原域名、账号、数据库和 OSS。升级 API 和管理后台后，一批构建生成网页和 Mac 两份界面资源，在后台确认一次上线。

记录现网 → 配置凭证 → 部署 API 和管理后台 → 构建 → 下载体验 → 确认主界面发布 → 验证各端。

| 操作 | 何时影响生产 |
| --- | --- |
| 部署 API | 会重启线上服务，旧网页随即使用新版 API；这一关要用旧网页验证 |
| 部署管理后台 | 更新线上管理后台，当前用户打开的主站仍是旧网页 |
| 运行 macOS 整包构建 | 同一批次登记网页和 Mac 候选 |
| 在「主界面」确认发布 | 切换主站资源并开放 Mac 更新 |

### 1. 记录现网，选定要发布的代码

- 在生产主站登录，打开一个已有子应用，记录当前用户、能读取的一条既有数据及主站版本；保留这个浏览器标签页，用来验证旧用户升级。记录生产主站、后台、API 域名和当前部署记录。备份现有数据库、服务器配置，并确认能取回当前运行的主站构建及其资源。
- 从用户实际网络访问主站的 `/web-version.json`。有 JSON 就记录 `build` 和可用的 `version`；旧站若返回 404 或首页 HTML，记作「旧站无版本标记」。旧版设置若一直显示 `0.1.0`，另外查历史发布记录确定最高已用版本。
- 在 GitHub 仓库 **Code → 分支选择器**确认目标分支已包含本次 API、后台、PWA、桌面及正式签名校验代码，记录 commit。执行下列 Actions 时都选这个分支，并在运行详情核对 commit 一致。待部署期间暂停其他主站发布，避免新旧流程同时改主站桶。若 GitHub 缺少手动运行按钮，检查工作流文件已在默认分支、仓库 Actions 已启用、操作者有写权限。[GitHub 手动运行说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

### 2. Apple 后台及 Mac 操作（首次一次）

下列顺序用于从 OSS 分发签名的 `T方舟.app`。准备好有双重认证的 Apple 开发者账号，并由已加入 Apple Developer Program 的团队 **Account Holder** 签发本地管理的 Developer ID 证书。若团队已有有效证书和配套私钥，从第 4 步复用。[Apple 角色与证书说明](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)

1. 登录 [Apple Developer Account](https://developer.apple.com/account/)，多团队账号先选正式发布团队。打开 **Membership details**，记录团队名称和 **Team ID**。会员未生效时先完成[开发者计划注册](https://developer.apple.com/programs/enroll/)。
2. 在 Mac 打开 **钥匙串访问 → 证书助理 → 从证书颁发机构请求证书**。输入申请人邮箱和便于辨识的常用名称，CA 邮箱留空，选 **存储到磁盘 → 继续**，得到 `.certSigningRequest`。
3. 账户持有人打开 [Certificates, Identifiers & Profiles → Certificates](https://developer.apple.com/account/resources/certificates/list)，点 **＋ → Software → Developer ID Application → Continue**。如果询问中间证书，选 **G2 Sub-CA**。点 **Choose File** 上传刚才的请求，再点 **Continue → Download**，得到 `.cer`。当前交付的是 App 归档，对应证书类型是 **Developer ID Application**。[证书申请说明](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)
4. 在生成请求的同一台 Mac 双击 `.cer`，导入 **登录** 钥匙串。在 **我的证书** 展开该证书，确认能看到专用密钥。选中该签名身份连同私钥，点 **文件 → 导出项目**，保存为 `DeveloperID.p12`，设置并保存非空导出口令。终端运行 `security find-identity -v -p codesigning`，复制完整的 `Developer ID Application: 团队名称 (TEAMID)`，核对 Team ID。
5. 登录 [Apple 账户](https://account.apple.com/)，打开 **登录与安全 → App 专用密码 → 生成 App 专用密码**，用途可填 `TBox GitHub macOS Notarization`。保存生成的值和对应邮箱供 GitHub 公证步骤使用。[Apple 专用密码说明](https://support.apple.com/zh-cn/102654)

遇到证书类型找不到、没有私钥或无法导出时，按[签名手册的逐屏操作及排错表](macos-developer-id-signing.md)处理。

### 3. GitHub 设置与服务器配置

**仓库级配置。** 进入仓库 **Settings → Secrets and variables → Actions**。在 **Variables** 和 **Secrets** 标签分别检查下表。已在旧部署中工作且指向本生产环境的值沿用。PM2 和后台 OSS 作业读取仓库可见的值；只把这些值填在桌面 Environment 里，这两个作业读不到。

| 位置 | 检查或填写 |
| --- | --- |
| Repository variables | `DEPLOY_DOMAIN` 为生产根域名，如 `tboxos.cn`；`OSS_REGION` 为现有桶实际地域，如 `cn-hangzhou`。沿用现网值 |
| Repository secrets | `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`APP_IMPORT_TOKEN`。PM2 另需 `PM2_SSH_KNOWN_HOSTS` 和现有认证方式对应的 `PM2_SSH_PRIVATE_KEY` 或 `PM2_SSH_PASSWORD` |
| 部署目标 | 对照 [PM2 工作流](../.github/workflows/api-pm2.yml) 的 SSH 目标及目录、[部署设置](../deploy/settings.mjs) 的根域名和桶映射，确认正是当前生产环境 |

**桌面环境。** 进入 **Settings → Environments → desktop-release**；首次点 **New environment**，输入 `desktop-release` 后进入配置页。在 **Environment variables → Add environment variable** 和 **Environment secrets → Add environment secret** 录入：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Variable | `APPLE_SIGNING_IDENTITY`、`APPLE_TEAM_ID` | 第 2 节的完整签名身份和 Team ID |
| Secret | `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD` | 在 .p12 所在目录执行 `openssl base64 -A -in './DeveloperID.p12' \| pbcopy`，将剪贴板内容粘入前者；后者填导出 .p12 的口令 |
| Secret | `APPLE_ID`、`APPLE_PASSWORD` | Apple 公证账号邮箱和刚生成的 App 专用密码 |
| Variable | `TBOX_UI_PUBLIC_KEY`、`TBOX_CORE_PUBLIC_KEY` | 分别粘贴方舟界面、核心更新公钥文件的完整内容 |
| Secret | `TBOX_UI_PRIVATE_KEY`、`TBOX_CORE_PRIVATE_KEY` | 分别粘贴对应私钥文件的完整内容 |
| Secret | `TBOX_UI_KEY_PASSWORD`、`TBOX_CORE_KEY_PASSWORD` | 两份方舟更新私钥各自的口令 |

若尚未生成方舟生产更新密钥，在已装工作区依赖的 Mac 上、仓库根目录执行下面命令，按 CLI 提示为两份密钥分别设置口令。已有生产密钥应复用。妥善备份私钥和口令，GitHub 只显示已保存的 Secret 名称。

```sh
umask 077
mkdir -p "$HOME/.tbox-release-keys"
pnpm --filter @t-box/desktop exec tauri signer generate -w "$HOME/.tbox-release-keys/desktop-ui.key"
pnpm --filter @t-box/desktop exec tauri signer generate -w "$HOME/.tbox-release-keys/desktop-core.key"
```

**服务器。** 编辑现有的 `/www/wwwroot/tbox/shared/api.env`，补入同一对 `TBOX_UI_PUBLIC_KEY`、`TBOX_CORE_PUBLIC_KEY`，生产 API 为 `https://api.tboxos.cn/api/v1` 时可省略 `TBOX_DESKTOP_API_BASE`；其他域名请配置为实际 HTTPS API 地址，包含 `/api/v1`，末尾不加斜杠。保留现有数据库、业务 OSS 凭证和其他配置。服务端 OSS 身份需要能读取私有候选，并将已批准的网页资源写入主站桶。保留原配置文件，避免用示例模板整份覆盖。[现有 PM2 配置说明](api-pm2-deployment.md)

### 4. GitHub Actions 第一次操作：升级现网 API

进入 **Actions → 后端部署（PM2）→ Run workflow → 选定发布分支**。勾选 `start_services`，点 **Run workflow**。点开本次运行，核对 commit，等数据库初始化与 PM2 服务启动完成。检查 API 健康，然后回到保留的旧网页，刷新数据或重新打开已有子应用，确认原账号及原数据仍可读取。

```sh
# 以下示例使用方舟默认域名；自定义部署替换为现网地址
curl -fsS 'https://api.tboxos.cn/api/v1/health' | jq '.data'
```

**放行条件**：HTTP 200、MySQL 为 `up`，旧网页的登录和数据读取正常。旧站功能异常就在这里处理，暂缓发布新界面。

### 5. GitHub Actions 第二次操作：只升级管理后台

进入 **Actions → 管理后台部署 → Run workflow**，选择发布分支直接运行。刷新后台，确认「系统发布」可切换两个渠道。

**放行条件**：两个页签都能读取列表，旧主站仍正常。新系统首次可能显示「暂无发布记录」，它只表示新发布表尚无记录。再次检查主站入口或原版本标记，应与第 1 步一致。

### 6. 构建主界面

提交根目录 `release-versions.json` 和本次代码。进入 **Actions → macOS 整包发布（内置本次界面）→ Run workflow**，选含该提交的分支。整包读取 `ui` 和 `macos.core`。

等签名、公证、桌面及网页候选登记成功，记录共享构建编号。

**放行条件**：后台两个页签中的构建编号、UI 版本一致，主站仍是旧版本。可从桌面端页签下载体验。

### 7. 先确认桌面版，保留一台首发 Mac

1. **系统发布 → 主界面 → 审核发布**，核对目标版本，填写更新说明并确认。
2. 用 Apple Silicon Mac 从 **下载安装包** 获取归档，解压，将 `T方舟.app` 放入「应用程序」后正常打开。在 **设置 → 系统版本** 核对两个版本；再点「检查更新」，应显示已是最新版本。使用生产账号核对一个已有子应用，保存截图。
3. 记录本次基线，保留 Mac 和安装包供下次升级验证。

### 8. 验证生产主站与 PWA

后台会依次写入资源、首页、Service Worker 和版本标记。发布中断时从「主界面」恢复同一批次。

从用户使用的网络和**原来的主站域名**检查以下资源。确认版本标记中的 `build`、`version` 对应本次候选，manifest 是有效 JSON，SW 和两张图标返回正确资源类型，而非路由回退的首页 HTML。

```sh
WEB='https://tboxos.cn'
curl -fsS "$WEB/web-version.json" | jq '{build,version}'
curl -fsS "$WEB/manifest.webmanifest" | jq '{name,start_url,scope,display,icons}'
for path in tbox-offline-sw.js pwa-192.png pwa-512.png; do
  curl -fsS -o /dev/null -w '%{http_code} %{content_type}\n' "$WEB/$path"
done
```

| 在哪里验收 | 具体怎么操作 | 通过条件 |
| --- | --- | --- |
| 旧网页标签页 | 回到第 1 步保留的标签页；若旧站已有更新检测，按提示更新。旧代码没有检测能力时，手动刷新一次进入新版 | 仍在原域名，能使用原账号、看到原有数据及子应用，设置显示目标界面版本 |
| 桌面浏览器 | 用正常浏览器访问主站；在 Chrome 开发者工具 **Application → Manifest / Service Workers** 查看应用名、图标、根作用域和活动的 worker；必要时待激活后刷新 | 页面读到有效 manifest，worker 控制主站；可安装的浏览器能通过安装入口独立打开 |
| iPhone | Safari 打开原主站 → 分享 → **添加到主屏幕** → 如有「作为网页 App 打开」则启用 → 添加。从新图标启动 | 图标、名称正确，独立窗口打开新版；按设备实际登录态验证账号和数据。[Apple 操作说明](https://support.apple.com/zh-cn/guide/iphone/iphea86e5236/ios) |
| Android | Chrome 打开原主站 → 浏览器菜单 → **安装应用**或**添加到主屏幕**。从桌面图标启动 | 图标可启动方舟，并以独立窗口显示。确认安装后的主界面已加载，再离线重开验证已缓存界面；涉及账号和业务数据的在线请求另测 |

若后台显示生效而主站仍返回旧标记，分别检查 OSS 源站和用户网络访问的自定义域名，核对 CDN 对首页、SW 及版本标记的缓存。只有用户的原网址已返回本批资源，主站切换才算通过。

### 9. 这次签收什么，下次签收什么

- **本次 A**：记录三个 Actions 运行链接、commit、共享构建 UUID 与版本、Apple 公证结果、原站切换前后标记、桌面首次安装截图、手机 PWA 主屏启动截图、原账号数据检查结果。按[生产验收记录表](production-system-release-acceptance.md#本次生产记录)填写。
- **下一次正式发布 B**：保留一份 A 版 PWA，验证检测到更新、下载进度、刷新后运行 B。用保留的 A 版 Mac 验证在线升级；只有 B 包含核心时，才能签收「下载后自动退出、安装并重新打开一次」。有了生产设备的 A → B 证据，再把[总进度表](desktop-system-updates.md)第 10 项标记通过。
