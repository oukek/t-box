# 方舟发版操作单 · 网页和 Mac 切换新流程，iOS 首次发包

本次目标为网页、PWA 和 Mac 主界面 **1.2.0**，Mac 核心 **1.0.2**，iOS 商店版本 **1.0.0**。iOS 包内置同一提交的 UI **1.2.0**。版本已写入仓库根目录的 [release-versions.json](../release-versions.json)。

## 这次照着勾

- [ ] **提交**：把本次代码推到 GitHub 的 `main`，核对上面的三个版本。
- [ ] **第一个 Action**：跑 **后端部署（PM2）**，勾选 `start_services`，等变绿。
- [ ] **第二个 Action**：跑 **管理后台部署**，等变绿。
- [ ] **第三个 Action**：如果线上界面低于 `1.2.0`、Mac 核心也低于 `1.0.2`，只跑一次 **macOS 整包发布（内置本次界面）**。它会一并构建网页、PWA 和签名 Mac UI。其他版本组合见第 1B 步。
- [ ] **方舟后台**：在「系统发布 → 桌面端」下载体验版；本次界面和核心一起升级时，在「系统发布 → 主界面」确认一次。
- [ ] **iOS 签名**：按第 2～5 步配置 Apple App ID、证书、描述文件和 GitHub 的 `ios-release` 环境。
- [ ] **选择首次发包方式**：只想拿 IPA，做第 6 步，关闭 `upload`。想一次打包并上传 Apple，先完成第 7 步，然后直接做第 8 步，勾选 `upload`。
- [ ] **iOS 上架**：Apple 处理完构建后，按第 9 步在 App Store Connect 选择构建、送审，审核通过后手动发布。

现有 Mac 签名和公证配置继续使用。iOS 使用 `com.tbox.app`、团队 `8BQ285B3J2` 和 Apple Distribution 证书。下文的 Apple 和 GitHub 配置都集中在 iOS 步骤里。

## 1. 提交代码并切换已上线的网页和 Mac

### 1A. 推送本次代码

1. 在项目根目录打开终端，执行下面三行。查看暂存清单，确认包含本次代码、版本文件、新工作流及脚本。iOS 证书、私钥和描述文件放在「下载」目录。

```bash
git status --short
git add -A
git diff --cached --stat
```

2. 确认清单后执行下面两行。

```bash
git commit -m "统一主界面发布并接入 iOS 发包"
git push origin main
```

3. 打开 GitHub 仓库 → **Code → main → release-versions.json**，核对 `ui` 是 `1.2.0`、`macos.core` 是 `1.0.2`、`ios` 是 `1.0.0`。后续每个 Action 的 **Branch** 都选 `main`，核对运行页的提交号一致。

### 1B. 网页和 Mac 按顺序操作

1. 方舟后台 → **应用管理 → 系统发布**。分别记下三个「当前生效」值：网页 UI ______、Mac UI ______、Mac 核心 ______。表里的「两个 UI」指网页和 Mac 各自的线上界面。
2. GitHub → **Actions → 后端部署（PM2）→ Run workflow**。Branch 选 `main`，勾选 **start_services**，点绿色 **Run workflow**。等整次变绿，用原网页登录并打开一个已有应用。
3. GitHub → **Actions → 管理后台部署 → Run workflow**。选 `main`，直接运行。变绿后刷新方舟后台，看到 **应用管理 → 系统发布 → 主界面 / 桌面端** 两个页签。
4. 对照下表，选一行执行。构建时选 `main`，版本由仓库读取。首次从旧流程切换时，若提示目标版本已被预留，请核对旧渠道的预留记录；重跑相同参数不会解除版本占用。

| 两个 UI 的线上版本 | 线上 Mac 核心 | 本次只跑哪个 Action | 在后台哪个页签确认 |
| --- | --- | --- | --- |
| 都低于 `1.2.0` | 低于 `1.0.2` | **macOS 整包发布（内置本次界面）**，生成网页、Mac 签名 UI 和完整安装包 | **主界面** |
| 都低于 `1.2.0` | 已是 `1.0.2` | **主界面构建（网页、PWA、Mac）**，复用已上线的核心 | **主界面** |
| 都是 `1.2.0` | 低于 `1.0.2` | **macOS 整包发布（内置本次界面）**，自动复用已批准的 UI，生成新安装包 | **桌面端** |
| 都是 `1.2.0` | 已是 `1.0.2` | 目标已上线，跳过本次构建和确认，继续配置 iOS | — |

若两个 UI 中只有一个已上线 `1.2.0`，首次统一发布应选高于两边预留基线的新 UI 版本。若线上核心已高于 `1.0.2`，只发 UI 可以保留现有核心；要调整本次目标时先核对版本记录。

5. **先体验。** 等 Action 变绿，到 **应用管理 → 系统发布 → 桌面端 → 本次待确认记录 → 下载体验版**。打开体验版，在 **设置 → 系统版本** 确认 UI `1.2.0`、核心 `1.0.2`。
6. **再上线。** 到表格最后一列的页签，找到刚体验的同一构建，点 **审核发布**，逐行填写更新内容，点一次 **确认发布**。
7. **核对结果。** 本次包含新 UI 时，打开 [主站版本标记](https://tboxos.cn/web-version.json)，确认 `version` 是 `1.2.0`、`build` 对应本次候选。仅更新核心时，网页保留原构建编号。最后用旧版正式 Mac 打开 **设置 → 系统版本 → 检查更新**，按提示更新并核对两个版本。

## 2. 在 Apple 开发者后台登记方舟的 App ID

先在 Finder → **下载** 中新建文件夹 `TBox-iOS`，后面的证书和下载文件都存到这里。

1. 用开发者账号登录 **Apple Developer → Account → Certificates, Identifiers & Profiles → Identifiers**。确认选中已加入 Apple Developer Program 的团队，在 Account → Membership details 核对 Team ID 为 `8BQ285B3J2`。创建分发描述文件需要 Account Holder 或 Admin 权限。
2. 搜索精确标识 **com.tbox.app**。如果已经在这个团队里，直接复用；没有则点 **＋ → App IDs → App → Continue**。
3. Description 填 `TBox iOS`，Bundle ID 选 **Explicit**，填 `com.tbox.app`，点 **Continue → Register**。
4. 打开已注册的 **com.tbox.app**，在 **Capabilities** 勾选 **Associated Domains** 并保存。接着去第 3 步导出证书。方舟子应用链接使用这个能力，和微信支付开关独立。如果此前已经生成描述文件，请重新生成并更新 GitHub 的 `IOS_PROFILE_BASE64`。

**核对** Identifiers 里能找到完整的 `com.tbox.app`。若 Apple 提示已被其他团队占用，先核对团队；如确实要换标识，需要同步修改原生工程、Capacitor、签名校验和本手册中的标识，再创建资料。[Apple 开发者后台](https://developer.apple.com/account/resources/identifiers/list)

## 3. 从 Mac 导出 iOS 发布证书

1. 打开 **钥匙串访问 → 登录 → 我的证书**，搜索 **Apple Distribution**。你之前列表里的**第 7 个**就是 **Apple Distribution: shaoxiong yu (8BQ285B3J2)**。
2. 在 Apple 后台 Certificates 确认该证书有效，再回到钥匙串。展开左侧箭头，下面应有一行**专用密钥**。选中这张证书所在的父行，右键 **导出**，选择 **个人信息交换 (.p12)**，保存为 `iOS-Distribution.p12`。
3. 设置一个非空导出密码，记下来。若只有证书没有私钥，请到当初创建证书的 Mac 导出，或者由团队管理员创建新的 Apple Distribution 证书。
4. 如果需要新建：在 Mac 的 **钥匙串访问 → 证书助理 → 从证书颁发机构请求证书**，填邮箱和常用名称，选 **存储到磁盘**。在 Apple 后台 **Certificates → ＋ → Apple Distribution** 上传 CSR，下载并双击 `.cer`，回到「我的证书」按上面步骤导出。

**核对** 手上有 `iOS-Distribution.p12` 和它的导出密码。你为 Mac 打包导出的 `DeveloperID.p12` 用在原来的桌面工作流。[Apple 证书管理](https://developer.apple.com/account/resources/certificates/list)

## 4. 下载方舟专用的 App Store 描述文件

1. Apple Developer → **Certificates, Identifiers & Profiles → Profiles → ＋**。
2. 在 **Distribution** 分组下选 **App Store Connect**，点 **Continue**。
3. App ID 选第 2 步的 **com.tbox.app**。证书选第 3 步导出的那一张 **Apple Distribution**。如果有多张同名证书，对照有效期和序列号。
4. 名称填 `TBox iOS App Store`，点 **Generate → Download**。为方便后续操作，把下载的文件改名为 `TBox-AppStore.mobileprovision`。

**核对** 把这个文件和第 3 步的 P12 放在 Mac 上同一个目录，例如「下载」里的 `TBox-iOS` 文件夹。工作流会校验团队、App ID、有效期和证书是否匹配。[Apple 创建描述文件](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/)

## 5. 在 GitHub 配置签名

1. GitHub 仓库 → **Settings → Environments → New environment**，填 **ios-release**，点 **Configure environment**。如果已经存在，点进去。
2. 在 **Environment variables → Add environment variable** 添加下表的变量。
3. 在 **Environment secrets → Add environment secret** 添加下表的密钥。两个文件用下面的命令**分次复制**，每执行一条就立即粘贴到对应的 GitHub 输入框并保存。

| 类型 | Name | Value |
| --- | --- | --- |
| Variable | `APPLE_TEAM_ID` | `8BQ285B3J2`（用你上面这张证书的团队） |
| Secret | `IOS_P12_BASE64` | `iOS-Distribution.p12` 文件的 Base64 |
| Secret | `IOS_P12_PASSWORD` | 导出这个 P12 时设置的密码 |
| Secret | `IOS_PROFILE_BASE64` | `TBox-AppStore.mobileprovision` 文件的 Base64 |

打开 Mac 的「终端」，执行 `cd ~/Downloads/TBox-iOS`，再执行 `ls`，确认看到上面命名的两个文件。下面这条命令把 P12 编码复制到剪贴板，终端通常没有输出。直接在 GitHub 的 Value 框按 Command + V，粘贴到 `IOS_P12_BASE64`。

```bash
base64 -i ./iOS-Distribution.p12 | tr -d '\n' | pbcopy
```

第二条复制描述文件，粘贴到 `IOS_PROFILE_BASE64`。

```bash
base64 -i ./TBox-AppStore.mobileprovision | tr -d '\n' | pbcopy
```

**核对** 在 **Settings → Secrets and variables → Actions → Variables** 检查仓库已有的 `DEPLOY_DOMAIN` 和 `OSS_REGION` 对这个环境可用。沿用网页部署的值，例如域名填 `tboxos.cn`，脚本会生成 `https://api.tboxos.cn/api/v1`。这里读取公共部署配置，出 IPA 无需 OSS 上传密钥。仅放在 `desktop-release` 环境里的变量不能被 `ios-release` 读取。

## 6. 第一次跑 Actions，只出 IPA

GitHub → **Actions → iOS 发包（App Store）→ Run workflow**，按下表填写，然后点绿色 **Run workflow**。

| 字段 | 第一次怎么填 |
| --- | --- |
| Branch | `main` |
| `build_number` | 留空，自动用这个工作流的运行序号。若这个 App 以前上传过同版本，请手填比 Apple 后台已有构建更大的正整数 |
| `upload` | **不勾选** |

**核对** 等「签名归档并导出 IPA」和「保留签名安装包」变绿，进入本次运行页底部 **Artifacts → Tbox-iOS-1.0.0-构建号**，下载并解压，可以看到 `Tbox.ipa`。Artifact 保留 14 天。这是正式商店签名包，普通 iPhone 不能从这个下载链接直接安装。做到这里已经完成“先试发包”。

## 7. 准备上传时，到 App Store Connect 创建 App 和上传密钥

1. 登录 **App Store Connect → Apps → ＋ → New App**。若已有对应 App 记录，直接打开它。
2. 平台勾 **iOS**，名称填可用的方舟商店名称，主要语言选 **简体中文**，Bundle ID 选 **com.tbox.app**，SKU 可填 `TBOX-IOS`，点 **Create**。如果无法创建，先请账户持有人检查协议、权限及团队选择。[Apple 创建应用记录](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)
3. **Users and Access → Integrations → App Store Connect API → Team Keys**。首次使用时由账户持有人按页面提示开通 API。点 **＋ / Generate API Key**，名称填 `TBox iOS CI`，角色选 **Developer**（可以上传构建）。使用团队密钥，后续工作流会同时读取 Issuer ID、Key ID 和 P8。[Apple 团队密钥与权限](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/)
4. 复制页面的 **Issuer ID** 和此密钥的 **Key ID**。点 **Download API Key** 保存 `AuthKey_实际KeyID.p8`，私钥只可下载一次。[Apple 创建上传密钥](https://developer.apple.com/documentation/AppStoreConnectAPI/creating-api-keys-for-app-store-connect-api)
5. 回到 GitHub 仓库 **Settings → Environments → ios-release**，按下表新增配置。

| 类型 | Name | Value |
| --- | --- | --- |
| Variable | `ASC_ISSUER_ID` | Apple 页面上的 Issuer ID，带连字符的一长串 |
| Variable | `ASC_KEY_ID` | 刚生成的 Key ID |
| Secret | `ASC_KEY_P8_BASE64` | 下载的 P8 文件的 Base64 |

在 P8 文件的目录执行，把文件名换成实际下载的名称，然后粘贴到 `ASC_KEY_P8_BASE64`。

```bash
base64 -i ./AuthKey_实际KeyID.p8 | tr -d '\n' | pbcopy
```

## 8. 运行 iOS Action，打包并上传给 Apple

1. **Actions → iOS 发包（App Store）→ Run workflow**。分支继续选 `main`，展示版本取自该提交 `release-versions.json` 的 `ios`，构建号留空或手填更大的值，这次**勾选 upload**。
2. 等「上传到 App Store Connect」变绿。到 **App Store Connect → Apps → 方舟 → TestFlight → iOS 构建版本**查看处理状态。这个页面可以查看上传结果，不需要开内测或邀请测试员。
3. 等 Apple 处理完成后到 **App Store / 分发 → iOS 版本 → 构建版本 → ＋**，应能选到对应的版本和构建号。如果卡在缺少出口合规信息，按应用实际情况回答加密问卷。如果处理失败，查看 Apple 邮件中的 ITMS 错误，再重新构建。[Apple 构建上传说明](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)

**如果要上传第 6 步那份完全相同的 IPA**，也可以在 Mac 打开 Apple 的 **Transporter**，登录同一团队，把解压出的 `Tbox.ipa` 拖进去，点 **Deliver / 交付**，再从上面第 2 小步继续。该方式可以跳过上传密钥配置和第二次打包。

## 9. 自己确认送审，再手动上线

1. **App Store Connect → Apps → 方舟 → 分发**，进入对应的 iOS 版本。新建 App 默认版本若是 `1.0`，先把版本页改为本次实际版本（本次为 `1.0.0`）；已有正式版时，点 **＋版本** 创建下一版。
2. 填写描述、关键词、支持网址、隐私政策网址，按页面要求上传 iPhone / iPad 截图。在 **App 信息、App 隐私、定价与销售范围** 完成年龄分级、隐私收集说明、价格和地区设置。选择中国大陆时，在 **App 信息** 核对 Apple 显示的备案及相关资质要求。[Apple 应用信息字段](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)
3. 在 **构建版本** 选刚处理完成的构建。在 **App 审核信息** 填联系人、可实际使用的审核账号和登录步骤。审核备注写明如何打开子应用、哪些资源随包内置、哪些通过后台加载、如何触发原生权限。按包内真实功能填写。[Apple 审核指南](https://developer.apple.com/app-store/review/guidelines/)
4. 在 **版本发布方式** 选 **手动发布此版本**，点 **保存 → 添加以供审核 → 提交审核**。这一步才正式送审。
5. 审核通过后状态为 **Pending Developer Release / 等待开发者发布**。确认准备上线，再点 **发布此版本 → 确认**。最后在所选地区用 iPhone 打开商店页面验证下载。[Apple 手动发布](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option)

## 下次修复怎么跑

- **同一商店版本还在准备中**：继续用文件中同一个 `ios` 版本，在 GitHub 新点 **Run workflow** 获取新构建号。Apple 已接收的「版本＋构建号」不能覆盖。若上传步骤报网络错误，先去 Apple 查看那次构建是否已经收到。
- **已上线后发新功能或修复**：在根目录 `release-versions.json` 把 `ios` 改为更高版本并提交，例如 `1.2.1`。iOS 字段不占用 Mac、网页或子应用的版本号。
- **签名步骤失败**：检查是否使用 `ios-release`、P12 导出密码、证书私钥和描述文件选中的证书。换发证书后重新生成描述文件，把两个 GitHub Secrets 一起更新。
- **上传鉴权失败**：检查 Team Key 的 Key ID、Issuer ID 和 P8 是否来自同一组，App 记录是否在同一团队。**仓库仍看不到 Action**：先检查工作流是否已推送到 GitHub 默认分支。


## 验证子应用直达

主站和 iOS 包都要部署本次代码。完成第 1B 步后即可核对站点配置。确认主站的 `/.well-known/apple-app-site-association` 直接返回 HTTP 200 和 JSON，内含 `8BQ285B3J2.com.tbox.app` 与 `/open.html`。目录统一使用 `https://tboxos.cn/open.html?app=todo` 这种链接，直接访问同一个静态文件，兼容 OSS。旧的 `/open/<appId>` 仍可由原生端接收。

在「备忘录」粘贴链接，用装了新包的 iPhone 点击，分别核对已安装子应用直达、未安装时显示应用详情、未登录时登录后继续。未装方舟时应显示共用引导页。iOS 商店上线后在管理后台配置 App Store 下载地址，引导页会读取该地址。
