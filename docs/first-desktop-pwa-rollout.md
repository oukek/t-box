# 方舟第一次发桌面版和 PWA：照着做

你的网页版已经在线。下面从提交代码开始，到手机从原网址安装 PWA 结束。**只需要跑三次 GitHub Actions。第 11 步才会切换用户正在使用的网页。**

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

**GitHub → Actions → 前端与后台部署（OSS）→ Run workflow**。分支选 **main**，**把 target 从默认的 all 改为 admin**；`ui_change` 保留 `patch`，`ui_version` 留空。运行并等绿色。登录生产管理后台，确认 **应用管理 → 系统发布** 能看到「桌面端」和「网页 / PWA」两个页签。

### 9. 跑第三个 Actions：一次构建桌面版和 PWA

**GitHub → Actions → 桌面系统候选（macOS）→ Run workflow**。按下表填：

| 字段 | 这次选什么 |
| --- | --- |
| Branch | main，与前两次是同一提交 |
| components | **both** |
| ui_change | 填这次要用的界面版本。比如线上最高已用 1.1.15，就填 1.1.16；已由版本系统管理则可选用 patch |
| core_change | 保留 patch |
| include_web | **勾选** |
| notes | 例如「新增 macOS 桌面版，支持将方舟添加到手机主屏幕」 |

点 **Run workflow**。等整次运行变绿，尤其确认「验证归档中的 Developer ID 签名与公证票据」「登记同版本网页与 PWA 候选」都通过。回方舟后台，看见**两个页签各一条待确认记录**再继续。此时旧网页还在运行。

#### 内测修复后怎样沿用版本号

**第一次可以用两个 `patch` 自动取号。修完 bug 要覆盖这包时，照抄后台「待确认」那一行的两个实际版本号。** 例如原来是联合构建（`both`）：

| 这次要做什么 | ui_change | core_change | 结果 |
| --- | --- | --- | --- |
| 第一次出内测包 | `patch` | `patch` | 假设后台分配界面 `1.0.2`、核心 `1.0.3` |
| 修 bug，替换刚才的内测包 | `1.0.2` | `1.0.3` | 两个版本号沿用，产生新的构建编号 |
| 再开一轮，两个组件都要升版 | `patch` | `patch` | 两个组件分别申请下一个补丁版本，即使上一包仍待确认 |

1. 确认生产 API 已部署支持同版本重建的版本。到 **方舟后台 → 应用管理 → 系统发布 → 桌面端**，记下本轮最新「待确认」记录的界面和核心版本。
2. **代码改过**：提交并推送修复，在 GitHub 新点 **Run workflow**，选包含修复的分支，保持原来的组件组合和 `include_web` 选择，按表格第二行手填版本。若原构建只发一个组件，只填参与构建的组件版本，另一栏保留默认 `patch`。**仅修正证书或凭证、要沿用原提交**：可在原任务点 **Re-run failed jobs**，复用该批次的预留号。
3. 每次运行会得到新的构建 UUID。原待确认记录在新任务成功预留版本时失效，新包登记后才可审核。如果新构建失败，可以继续用同版号重建。
4. 内测人员打开此次 Actions 运行的 **Summary**，按「macOS 内部体验包」中的私有 OSS 对象路径下载归档，在测试 Mac 上退出上一份体验 App，解压并手动打开新包。用独立测试账户或干净的 macOS 用户测试，避免已缓存的正式界面影响结果。同版本内测包要手动替换。保留后台「待确认」即可继续下一轮。
5. 最终验收通过，再按下面两步分别确认桌面及网页上线。任一关联渠道已开始发布后，这一批版本号即受保护。

### 10. 在方舟后台，先发桌面版

**应用管理 → 系统发布 → 桌面端 → 审核发布 → 确认发布**。点「下载安装包」，在 Apple Silicon Mac 解压，把 T方舟拖进「应用程序」后打开。进 **设置 → 系统版本**，确认界面和核心版本与后台一致，再登录打开一个子应用。保留这台 Mac 供下次测自动升级。

### 11. 在方舟后台，最后发网页和 PWA

确认准备好切换现网后，再点 **应用管理 → 系统发布 → 网页 / PWA → 本次候选的「审核发布」→ 确认发布**。等状态变为「当前生效」。

- **电脑**：在旧标签页按更新提示操作；旧站没有检测功能就刷新一次。确认仍是原域名，能读到原账号的数据。在主站网址后加 `/web-version.json`，应看到本次的版本号。
- **iPhone**：Safari 打开原网址 → 分享 → **添加到主屏幕** → 添加。回桌面点方舟图标，确认可以打开。
- **Android**：Chrome 打开原网址 → 菜单 → **安装应用 / 添加到主屏幕**。回桌面点图标，确认可以打开。

到这里，本次首发完成。下次发布新版本时，再用这次安装的 Mac 和 PWA 验证自动更新。**任何一步没达到写明的结果，先停在那一步。** [详细检查与失败处理](first-desktop-pwa-rollout-details.md) · [Apple 证书排错](macos-developer-id-signing.md) · [生产验收记录表](production-system-release-acceptance.md)
