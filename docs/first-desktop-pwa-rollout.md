# 方舟第一次发桌面版和 PWA：照着做

## 日常发布 UI，工作流怎么选

| 这次要更新 | 跑哪个 Action | 在哪确认上线 |
| --- | --- | --- |
| 更新网页、PWA 和 Mac 界面 | 主界面构建（网页、PWA、Mac） | 系统发布 → 主界面 |
| 只更新 Mac 核心（保留线上 UI 版本） | macOS 整包发布（内置本次界面） | 系统发布 → 桌面端 |
| Mac 界面和核心一起更新（含首次安装） | macOS 整包发布（内置本次界面） | 系统发布 → 主界面 |
| 只更新管理后台 | 管理后台部署 | 直接部署后台 |
| 更新 iOS 宿主界面 | iOS 发包（App Store） | App Store Connect |

首次切换先部署后端和管理后台。新 UI 版本须高于旧网页和 Mac 两边的预留基线。最新待确认的统一候选可沿用同号重建。


完整首发共跑三次 GitHub Actions。第 10 步确认后用户可以更新。

### 1. 在 Mac 上，把代码提交到 GitHub

在项目目录打开终端：

```sh
git status --short
git add -A
git diff --cached --stat
```

看一遍清单，确认都是要发布的改动，没有个人配置、证书、密钥或无关文件，再运行：

```sh
git commit -m "发布方舟桌面版和 PWA 支持"
git push origin main
```

打开 GitHub 仓库 → **Code → main**，确认能看到刚提交的记录。记下这次提交号。备份现有生产数据库、主站文件和服务器配置；用浏览器打开当前生产网页，登录并留着这个标签页。

### 2. 在 Apple 后台，找到团队编号

打开 [Apple 开发者账户](https://developer.apple.com/account/)，用正式团队的 **Account Holder（账户持有人）** 登录。选团队 → **Membership details** → 记下 **Team ID**。如果还没加入 Apple Developer Program，先在[注册入口](https://developer.apple.com/programs/enroll/)完成申请，等会员生效。

如果你已经有这个团队的 **Developer ID Application** 证书、配对私钥和可用的 .p12，直接到第 4 步获取公证密码。

### 3. 先在 Mac 生成请求，再去 Apple 点「＋」领证书

1. **Mac** → 用 Spotlight 搜索「钥匙串访问」→ 顶部菜单 **钥匙串访问 → 证书助理 → 从证书颁发机构请求证书**。填邮箱和常用名称，CA 邮箱留空，选「存储到磁盘」，保存请求文件。
2. **Apple** → 打开[证书列表](https://developer.apple.com/account/resources/certificates/list) → **＋ → Developer ID Application → Continue**。若出现中间证书选项，选 **G2**。点 **Choose File** 上传刚才的请求文件 → **Continue → Download**。
3. **回到同一台 Mac** → 双击下载的 .cer → 打开「钥匙串访问 → 登录 → 我的证书」。展开新证书，看到下面有**专用密钥**。选中该签名身份和私钥 → **文件 → 导出项目** → 保存为 `DeveloperID.p12`，给它设置导出口令并记好。
4. 在终端执行 `security find-identity -v -p codesigning`，复制完整的 **Developer ID Application: 名称 (团队编号)**，第 6 步要填。

### 4. 在 Apple 账户，生成公证密码

打开 [Apple 账户](https://account.apple.com/) → **登录与安全 → App 专用密码 → 生成**。名称可填 `TBox GitHub`。记下生成的密码和登录邮箱。至此 Apple 后台操作完成。

### 5. 在 Mac 上，准备方舟自己的两套更新密钥

如果已有方舟**生产**更新密钥，沿用原来的。首次生成时，在项目根目录运行：

```sh
umask 077
mkdir -p "$HOME/.tbox-release-keys"
pnpm --filter @t-box/desktop exec tauri signer generate -w "$HOME/.tbox-release-keys/desktop-ui.key"
pnpm --filter @t-box/desktop exec tauri signer generate -w "$HOME/.tbox-release-keys/desktop-core.key"
```

按提示设置并记下两个口令。生成的 `.key` 是私钥，`.key.pub` 是公钥。文件放在仓库外，并备份到团队受控位置。

### 6. 在 GitHub 填变量，再把两个公钥填到服务器

打开 **GitHub 仓库 → Settings → Environments → New environment**，名称填 **desktop-release**。已经有这个环境就直接点进去。每一行建一个同名配置：

| 点哪个按钮 | 名称 | 复制什么进去 |
| --- | --- | --- |
| Add environment variable | `APPLE_TEAM_ID` | 第 2 步的 Team ID |
| Add environment variable | `APPLE_SIGNING_IDENTITY` | 第 3 步的完整 Developer ID Application 名称 |
| Add environment variable | `TBOX_UI_PUBLIC_KEY` | desktop-ui.key.pub 全文 |
| Add environment variable | `TBOX_CORE_PUBLIC_KEY` | desktop-core.key.pub 全文 |
| Add environment secret | `APPLE_CERTIFICATE` | 在 .p12 所在目录运行 `openssl base64 -A -in DeveloperID.p12 \| pbcopy`，直接粘贴 |
| Add environment secret | `APPLE_CERTIFICATE_PASSWORD` | 第 3 步导出 .p12 时设的口令 |
| Add environment secret | `APPLE_ID` | 第 4 步的 Apple 登录邮箱 |
| Add environment secret | `APPLE_PASSWORD` | 第 4 步生成的 App 专用密码 |
| Add environment secret | `TBOX_UI_PRIVATE_KEY` | desktop-ui.key 全文 |
| Add environment secret | `TBOX_UI_KEY_PASSWORD` | desktop-ui.key 的口令 |
| Add environment secret | `TBOX_CORE_PRIVATE_KEY` | desktop-core.key 全文 |
| Add environment secret | `TBOX_CORE_KEY_PASSWORD` | desktop-core.key 的口令 |

然后做两件事：

- **GitHub 仓库 → Settings → Secrets and variables → Actions**：检查旧站已有的 Variables `DEPLOY_DOMAIN`、`OSS_REGION`，以及 Secrets `APP_IMPORT_TOKEN`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`PM2_SSH_KNOWN_HOSTS` 和原有 SSH 私钥或密码。已有且能用的保持原值。
- **登录生产服务器**，编辑已有的 `/www/wwwroot/tbox/shared/api.env`。保留其他行，补上 `TBOX_UI_PUBLIC_KEY=界面公钥全文`、`TBOX_CORE_PUBLIC_KEY=核心公钥全文`。如果生产 API 是 `https://api.tboxos.cn/api/v1`，这就是后端默认值，可以跳过 `TBOX_DESKTOP_API_BASE`。使用其他生产 API 域名时才需添加此变量，值填完整 HTTPS API 地址，保留 `/api/v1`，末尾不加斜杠。保存。

### 7. 跑第一个 Actions：后端部署（PM2）

**GitHub → Actions → 后端部署（PM2）→ Run workflow**。分支选 **main**，勾选 **start_services**，点绿色 **Run workflow**。等整次运行变绿，再回到第 1 步保留的旧网页，打开一个已有子应用，确认能读到原账号的数据。失败就停在这一步。

### 8. 跑第二个 Actions：只发管理后台

**GitHub → Actions → 管理后台部署 → Run workflow**。分支选 **main**，直接运行。完成后登录后台，核对「应用管理 → 系统发布」的两个渠道。

### 9. 构建同一批次的网页和 Mac 资源

1. 在根目录打开 `release-versions.json`。首次整包核对 `ui` 和 `macos.core`，日常只更新界面时改 `ui`。将版本和代码一起提交。
2. 在 GitHub Actions 打开 **macOS 整包发布（内置本次界面）**，选择上述分支并运行。
3. 等「构建网页并登记同一批次的主界面候选」成功。在后台找到本次构建编号。

#### 内测修复后怎样沿用版本号

1. 在后台确认当前候选仍待确认，并且是该组件最新预留的版本。
2. 修复代码，保留文件中本轮版本，提交并推送。新点 **Run workflow**，选择原工作流和含修复的分支。如果只修正证书且代码相同，可在原任务点 **Re-run failed jobs**。

3. 每次运行会得到新的构建 UUID。原待确认记录在新任务成功预留版本时失效，新包登记后才可审核。如果新构建失败，可以继续用同版号重建。
4. 管理员到 **应用管理 → 系统发布 → 桌面端**，在本次「待确认」记录点 **下载体验版**。联合构建和仅核心构建可按芯片下载 DMG，打开后将 T方舟拖到 Applications。仅测界面时运行「主界面构建（网页、PWA、Mac）」，使用文件中的 `ui`。后台下载的 ZIP 含当前线上核心原包和本次已签名的 UI。在对应芯片的 Mac 上先完全退出方舟，解压 ZIP，双击「启动体验版.command」，保留终端窗口至体验结束。在「设置 → 系统版本」核对两个版本号。仅 UI 体验使用临时更新目录，退出后再启动正式 App 即可。若显示「基线已变化」，请基于新的线上组合重新构建。用独立测试账户或干净的 macOS 用户测试，避免已缓存的正式界面影响结果。同版本内测包要手动替换。保留后台「待确认」即可继续下一轮。
5. 体验通过后在「主界面」确认一次。

### 10. 在后台统一发布主界面

**应用管理 → 系统发布 → 主界面 → 审核发布 → 逐行填写更新内容 → 确认发布**。生效后，Apple 芯片和 Intel Mac 分别在设置中检查更新，核对界面和核心版本。

### 11. 验证现有网页和 PWA

主站的 `/web-version.json` 应显示本次的版本、构建编号和更新说明。

- **电脑**：在旧标签页按更新提示操作；旧站没有检测功能就刷新一次。确认仍是原域名，能读到原账号的数据。在主站网址后加 `/web-version.json`，应看到本次的版本号。
- **iPhone**：Safari 打开原网址 → 分享 → **添加到主屏幕** → 添加。回桌面点方舟图标，确认可以打开。
- **Android**：Chrome 打开原网址 → 菜单 → **安装应用 / 添加到主屏幕**。回桌面点图标，确认可以打开。

到这里，本次首发完成。下次发布新版本时，再用这次安装的 Mac 和 PWA 验证自动更新。**任何一步没达到写明的结果，先停在那一步。** [详细检查与失败处理](first-desktop-pwa-rollout-details.md) · [Apple 证书排错](macos-developer-id-signing.md) · [生产验收记录表](production-system-release-acceptance.md)
