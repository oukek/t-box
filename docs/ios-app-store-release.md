# 方舟发版操作单 · 网页和 Mac 切换新流程，iOS 首次发包

服务号与 iOS 移动应用使用同一微信身份，按 [UnionID 配置与验收步骤](wechat-unionid-setup.md) 操作。

本次目标为网页、PWA 和 Mac 主界面 **1.3.1**，Mac 核心 **1.0.2**，iOS 商店版本 **1.0.0**。iOS 包内置同一提交的 UI **1.3.1**。版本已写入仓库根目录的 [release-versions.json](../release-versions.json)。

网页和 Mac 已经完成本次发布的话，直接从 **第 2 步** 开始。iOS 的目标是一次运行完成签名、打包和上传，在 Apple 后台看到 `1.0.0`。

## 这次照着勾

- [ ] **提交**：把本次代码推到 GitHub 的 `main`，核对上面的三个版本。
- [ ] **第一个 Action**：跑 **后端部署（PM2）**，勾选 `start_services`，等变绿。
- [ ] **第二个 Action**：跑 **管理后台部署**，等变绿。
- [ ] **第三个 Action**：本次新增悬浮窗开关。线上 Mac 核心已是 `1.0.2` 时，只跑 **主界面构建（网页、PWA、Mac）**；若线上核心也需要升到 `1.0.2`，只跑 **macOS 整包发布（内置本次界面）**。两种情况均在后台「主界面」确认。
- [ ] **方舟后台**：在「系统发布 → 桌面端」下载体验版；本次界面和核心一起升级时，在「系统发布 → 主界面」确认一次。
- [ ] **iOS 首次发包并上传**：第 2～5 步备齐 Apple 资料，第 6 步在 GitHub 一次填齐，第 7 步勾选 `upload` 运行一次，第 8 步在 Apple 核对构建。
- [ ] **iOS 上架**：Apple 处理完构建后，按第 9 步在 App Store Connect 选择构建、送审，审核通过后手动发布。

现有 Mac 签名和公证配置继续使用。iOS 使用 `cn.tboxos.ark`、团队 `8BQ285B3J2` 和 Apple Distribution 证书。下文的 Apple 和 GitHub 配置都集中在 iOS 步骤里。

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

3. 打开 [GitHub 上 main 分支的版本文件](https://github.com/oukek/t-box/blob/main/release-versions.json)，核对 `ui` 是 `1.3.1`、`macos.core` 是 `1.0.2`、`ios` 是 `1.0.0`。后续每个 Action 的 **Branch** 都选 `main`，核对运行页的提交号一致。

### 1B. 网页和 Mac 按顺序操作

1. 打开 [方舟管理后台](https://admin.tboxos.cn) → **应用管理 → 系统发布**。分别记下三个「当前生效」值：网页 UI ______、Mac UI ______、Mac 核心 ______。表里的「两个 UI」指网页和 Mac 各自的线上界面。
2. 打开 [后端部署（PM2）](https://github.com/oukek/t-box/actions/workflows/api-pm2.yml)，点 **Run workflow**。Branch 选 `main`，勾选 **start_services**，点绿色 **Run workflow**。等整次变绿，用原网页登录并打开一个已有应用。
3. 打开 [管理后台部署](https://github.com/oukek/t-box/actions/workflows/admin-oss.yml)，点 **Run workflow**。选 `main`，直接运行。变绿后刷新方舟后台，看到 **应用管理 → 系统发布 → 主界面 / 桌面端** 两个页签。
4. 对照下表，选一行执行。构建时选 `main`，版本由仓库读取。首次从旧流程切换时，若提示目标版本已被预留，请核对旧渠道的预留记录；重跑相同参数不会解除版本占用。

| 两个 UI 的线上版本 | 线上 Mac 核心 | 本次只跑哪个 Action | 在后台哪个页签确认 |
| --- | --- | --- | --- |
| 都低于 `1.3.1` | 低于 `1.0.2` | [macOS 整包发布（内置本次界面）](https://github.com/oukek/t-box/actions/workflows/desktop-release.yml)，生成网页、Mac 签名 UI 和完整安装包 | **主界面** |
| 都低于 `1.3.1` | 已是 `1.0.2` | [主界面构建（网页、PWA、Mac）](https://github.com/oukek/t-box/actions/workflows/web-oss.yml)，复用已上线的核心 | **主界面** |
| 都是 `1.3.1` | 低于 `1.0.2` | [macOS 整包发布（内置本次界面）](https://github.com/oukek/t-box/actions/workflows/desktop-release.yml)，自动复用已批准的 UI，生成新安装包 | **桌面端** |
| 都是 `1.3.1` | 已是 `1.0.2` | 目标已上线，跳过本次构建和确认，继续配置 iOS | — |

若两个 UI 中只有一个已上线 `1.3.1`，首次统一发布应选高于两边预留基线的新 UI 版本。若线上核心已高于 `1.0.2`，只发 UI 可以保留现有核心；要调整本次目标时先核对版本记录。

5. **先体验。** 等 Action 变绿，打开 [方舟管理后台](https://admin.tboxos.cn) → **应用管理 → 系统发布 → 桌面端 → 本次待确认记录 → 下载体验版**。打开体验版，在 **设置 → 系统版本** 确认 UI `1.3.1`、核心 `1.0.2`。
6. **再上线。** 到表格最后一列的页签，找到刚体验的同一构建，点 **审核发布**，逐行填写更新内容，点一次 **确认发布**。
7. **核对结果。** 本次包含新 UI 时，打开 [主站版本标记](https://tboxos.cn/web-version.json)，确认 `version` 是 `1.3.1`、`build` 对应本次候选。仅更新核心时，网页保留原构建编号。最后用旧版正式 Mac 打开 **设置 → 系统版本 → 检查更新**，按提示更新并核对两个版本。

## 2. 在 Apple 开发者后台确认已注册的 App ID

在 Mac 上打开「终端」，复制下面一行，按回车。Finder 会打开一个文件夹；后面三个文件都放进这个文件夹。

```bash
mkdir -p ~/Downloads/TBox-iOS && open ~/Downloads/TBox-iOS
```

1. 先登录 [Apple Developer 账户](https://developer.apple.com/account/)，在 **Membership details** 核对 Team ID 为 `8BQ285B3J2`。创建分发描述文件需要 Account Holder 或 Admin 权限。
2. 打开 [Apple 的 Identifiers 列表](https://developer.apple.com/account/resources/identifiers/list)，搜索你已注册的 **cn.tboxos.ark**，点开这条记录。
3. 在 **Capabilities** 找到并勾选 **Associated Domains**，点 **Save**。若已经勾选，直接进入第 3 步导出证书。后面创建描述文件和商店记录都选择这条 App ID。

## 3. 从 Mac 导出 iOS 发布证书

1. 打开 **钥匙串访问 → 登录 → 我的证书**，搜索 **Apple Distribution**。你之前列表里的**第 7 个**就是 **Apple Distribution: shaoxiong yu (8BQ285B3J2)**。
2. 打开 [Apple 的 Certificates 列表](https://developer.apple.com/account/resources/certificates/list)，确认该证书有效，再回到钥匙串。展开左侧箭头，下面应有一行**专用密钥**。选中这张证书所在的父行，右键 **导出**，选择 **个人信息交换 (.p12)**，保存为 `iOS-Distribution.p12`。
3. 设置一个非空导出密码，记下来。若只有证书没有私钥，请到当初创建证书的 Mac 导出，或者由团队管理员创建新的 Apple Distribution 证书。
4. 如果需要新建：在 Mac 的 **钥匙串访问 → 证书助理 → 从证书颁发机构请求证书**，填邮箱和常用名称，选 **存储到磁盘**。在 Apple 后台 **Certificates → ＋ → Apple Distribution** 上传 CSR，下载并双击 `.cer`，回到「我的证书」按上面步骤导出。

**核对** 手上有 `iOS-Distribution.p12` 和它的导出密码。你为 Mac 打包导出的 `DeveloperID.p12` 用在原来的桌面工作流。[Apple 证书管理](https://developer.apple.com/account/resources/certificates/list)

## 4. 下载方舟专用的 App Store 描述文件

1. 打开 [Apple 的 Profiles 列表](https://developer.apple.com/account/resources/profiles/list)，点标题旁的 **＋**。
2. 在 **Distribution** 分组下选 **App Store Connect**，点 **Continue**。
3. App ID 选第 2 步的 **cn.tboxos.ark**。证书选第 3 步导出的那一张 **Apple Distribution**。如果有多张同名证书，对照有效期和序列号。
4. 名称填 `TBox iOS App Store`，点 **Generate → Download**。为方便后续操作，把下载的文件改名为 `TBox-AppStore.mobileprovision`。

**核对** 把这个文件和第 3 步的 P12 放在 Mac 上同一个目录，例如「下载」里的 `TBox-iOS` 文件夹。工作流会校验团队、App ID、有效期和证书是否匹配。[Apple 创建描述文件](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/)

## 5. 在 Apple 创建 App 记录和上传密钥

### 5A. 建立方舟的商店记录

1. 打开 [App Store Connect 的 App 列表](https://appstoreconnect.apple.com/apps)，用方舟团队账号登录。有多个团队时，先切到团队 `8BQ285B3J2`。
2. 如果列表中已有方舟，点进去，在 **App 信息** 核对 Bundle ID 为 `cn.tboxos.ark`，然后继续 5B。首次创建时，点 **＋ → 新建 App（New App）**。
3. 平台勾 **iOS**，名称填可用的商店名称，主要语言选 **简体中文**，Bundle ID 选择 `cn.tboxos.ark`，SKU 填 `TBOX-IOS`，点 **创建**。看到新 App 出现在列表里即可。[Apple 创建 App 说明](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)

### 5B. 创建团队上传密钥

1. 打开 [App Store Connect 的团队密钥页面](https://appstoreconnect.apple.com/access/integrations/api)。如果登录后回到了首页，依次点 **用户和访问（Users and Access）→ 集成（Integrations）→ App Store Connect API → 团队密钥（Team Keys）**。
2. 首次使用若看到 **请求访问权限（Request Access）**，由**账户持有人**点它、勾选同意条款并提交，等 Apple 批准后回到这个页面。已经能看到 **生成 API 密钥** 或 **＋** 就直接继续。
3. 在 **团队密钥** 下点 **生成 API 密钥（Generate API Key）**；已有活跃密钥时点列表旁的 **＋**。创建这个密钥的登录账号需要是**账户持有人或管理员**。
4. **名称（Name）** 填 `TBox iOS CI`；**访问权限（Access）** 选 **开发者（Developer）**；点 **生成（Generate）**。Developer 权限足够让 GitHub 上传构建。[Apple 团队密钥说明](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/) · [Apple 上传权限说明](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)

### 5C. 在同一页取出两个编号和一个文件

| 要拿什么 | 在团队密钥页面具体点哪里 | 第 6 步填到 GitHub 哪里 |
| --- | --- | --- |
| **Issuer ID** | 找团队密钥列表上方标着 **Issuer ID** 的一长串编号，点旁边的 **复制（Copy）**，保留连字符 | Variable `ASC_ISSUER_ID` |
| **Key ID** | 在 **活跃（Active）** 密钥列表找到 `TBox iOS CI`，复制**该行 Key ID 列**的编号 | Variable `ASC_KEY_ID` |
| **P8 私钥** | 在 `TBox iOS CI` 对应行点 **下载 API 密钥（Download API Key）**，确认下载。将文件移到 Mac 的 `下载/TBox-iOS` 文件夹，保留原名 | 在第 6C 步把文件编码后填入 Secret `ASC_KEY_P8_BASE64` |

保留这个 Apple 页面，再开一个 GitHub 标签页。第 6B 步逐个复制、逐个保存。下载文件名应为 `AuthKey_你的KeyID.p8`，中间的编号应和刚才那行 Key ID 完全相同。P8 私钥只可下载一次。[Apple 密钥说明](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/)

**完成标志**：Finder 文件夹里能看到 `iOS-Distribution.p12`、`TBox-AppStore.mobileprovision` 和一个 `AuthKey_….p8`；你手里还有导出 P12 时设置的密码。

## 6. 在 GitHub 一次填齐配置

### 6A. 打开正确的环境

1. 在浏览器新标签页打开 [方舟仓库的 Environments](https://github.com/oukek/t-box/settings/environments)。
2. 如果列表已有 **ios-release**，点它。如果没有，点 **New environment**，输入 `ios-release`，点 **Configure environment**。
3. 页面中找到 **Environment variables** 和 **Environment secrets** 两个区域。下面每一项单独保存。

### 6B. 添加 3 个 iOS Variables

每做一行，都点一次 **Add environment variable** → 在 **Name** 粘贴第二列 → 在 **Value** 填第三列 → **Add variable**。

| 完成 | Name | Value 怎么拿 |
| --- | --- | --- |
| □ | `APPLE_TEAM_ID` | 填 `8BQ285B3J2`，可在 Apple Developer → Account → Membership details 核对 |
| □ | `ASC_ISSUER_ID` | 切回 Apple 的 **Team Keys** 页面，复制上方的 **Issuer ID**，保留连字符 |
| □ | `ASC_KEY_ID` | 在同一页面找到 `TBox iOS CI` 那一行，复制 **Key ID**。它也在下载的 P8 文件名中，位于 `AuthKey_` 和 `.p8` 之间 |

### 6C. 添加 4 个 Secrets，逐个保存

先在 Mac 终端执行：

```bash
cd ~/Downloads/TBox-iOS
ls -1
```

确认文件名与第 5 步一致。下面每条 `pbcopy` 命令都把结果放进剪贴板，终端通常没有输出。每复制一次，就直接粘贴到 GitHub 的 **Secret** 值框并保存。

1. **P12 文件**。在 GitHub 点 **Add environment secret**，Name 填 `IOS_P12_BASE64`。回到终端执行下面这一条，再到 GitHub 的值框按 **Command + V**，点 **Add secret**。

   ```bash
   base64 -i ./iOS-Distribution.p12 | tr -d '\n' | pbcopy
   ```

2. **P12 密码**。再点 **Add environment secret**，Name 填 `IOS_P12_PASSWORD`。值框直接输入第 3 步导出 P12 时设置的密码，点 **Add secret**。

3. **描述文件**。再点 **Add environment secret**，Name 填 `IOS_PROFILE_BASE64`。执行下面这条，粘贴到值框，点 **Add secret**。

   ```bash
   base64 -i ./TBox-AppStore.mobileprovision | tr -d '\n' | pbcopy
   ```

4. **上传私钥**。再点 **Add environment secret**，Name 填 `ASC_KEY_P8_BASE64`。终端执行下面这条。看到提示后，把第 6B 步的 **Key ID** 粘到终端，按回车。接着执行下方第二条命令复制 P8，再到 GitHub 值框按 **Command + V**，点 **Add secret**。

   ```bash
   printf '请输入 Apple 的 Key ID，然后按回车：'; read -r asc_key_id
   ```

   输入编号并回车后，再单独执行这一条：

   ```bash
   base64 -i "./AuthKey_${asc_key_id}.p8" | tr -d '\n' | pbcopy
   ```

### 6D. 核对 2 个公共 Variables

1. 打开 [方舟仓库的 Actions Variables](https://github.com/oukek/t-box/settings/variables/actions)，在 **Repository variables** 中找下面两项。

   | Name | 本次应使用的值 |
   | --- | --- |
   | `DEPLOY_DOMAIN` | `tboxos.cn` |
   | `OSS_REGION` | 网页生产部署使用的 OSS 地域。格式如 `cn-hangzhou`，请复制实际值 |

2. 仓库级已有这两项且值正确，直接去第 7 步。如果它们只在 `desktop-release` 环境里，打开那个环境复制实际值，回到 `ios-release`，按第 6B 步的方法分别添加。
3. 回到 `ios-release` 对照名称：**3 个 Apple Variables、4 个 Secrets**，外加能从仓库或当前环境读取的 **2 个公共 Variables**。

## 7. 第一次运行 iOS Action 就上传 Apple

1. 打开 [GitHub → iOS 发包（App Store）](https://github.com/oukek/t-box/actions/workflows/ios-release.yml)，点右侧 **Run workflow**。
2. 按下表填完再点绿色 **Run workflow**。

   | 界面上的选项 | 这次怎么填 |
   | --- | --- |
   | **Branch** | 选 `main`，确认已包含本次发版提交 |
   | **构建号**（`build_number`） | 首次上传 `1.0.0` 留空，工作流会自动填。若 Apple 已收过同版本的构建，填大于已有构建号的整数 |
   | **上传到 App Store Connect**（`upload`） | **勾选 ✓** |

3. 点进刚启动的那条运行 → **package**。等 **签名归档并导出 IPA**、**保留签名安装包**、**上传到 App Store Connect** 三步依次变绿。最后一项变绿后去第 8 步。

## 8. 在 Apple 核对上传结果

1. 在 GitHub 运行详情中确认 **上传到 App Store Connect** 这一步变绿。Artifacts 中也会保留这次的签名 IPA。
2. 打开 [App Store Connect 的 App 列表](https://appstoreconnect.apple.com/apps)，点 **方舟 → TestFlight → iOS 构建版本**，找到 `1.0.0` 和本次构建号，等待 Apple 处理完成。此处查看上传状态即可。
3. 打开 **分发 → iOS 版本 1.0.0 → 构建版本 → ＋**，应能选中这次构建。接着按第 9 步送审。[Apple 上传与处理说明](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)

## 9. 自己确认送审，再手动上线

本次简体中文文案、公开网址、分设备截图及填写顺序见 [iOS 1.0.0 上架资料](app-store/1.0.0/README.md)。

1. 打开 [App Store Connect 的 App 列表](https://appstoreconnect.apple.com/apps)，点 **方舟 → 分发**，进入对应的 iOS 版本。新建 App 默认版本若是 `1.0`，先把版本页改为本次实际版本（本次为 `1.0.0`）；已有正式版时，点 **＋版本** 创建下一版。
2. 填写描述、关键词、支持网址、隐私政策网址，按页面要求上传 iPhone / iPad 截图。在 **App 信息、App 隐私、定价与销售范围** 完成年龄分级、隐私收集说明、价格和地区设置。选择中国大陆时，在 **App 信息** 核对 Apple 显示的备案及相关资质要求。[Apple 应用信息字段](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)
3. 在 **构建版本** 选刚处理完成的构建。在 **App 审核信息** 填联系人、可实际使用的审核账号和登录步骤。审核备注写明如何打开子应用、哪些资源随包内置、哪些通过后台加载、如何触发原生权限。按包内真实功能填写。[Apple 审核指南](https://developer.apple.com/app-store/review/guidelines/)
4. 在 **版本发布方式** 选 **手动发布此版本**，点 **保存 → 添加以供审核 → 提交审核**。这一步才正式送审。
5. 审核通过后状态为 **Pending Developer Release / 等待开发者发布**。确认准备上线，再点 **发布此版本 → 确认**。最后在所选地区用 iPhone 打开商店页面验证下载。[Apple 手动发布](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option)

### 为审核准备普通账号

1. 部署本次「后端部署（PM2）」并确认健康检查通过，再部署管理后台、打包并在后台确认发布电商助手 1.3.5，最后重新构建 iOS 1.0.0。网页和 PWA 要同步登录入口时，运行「主界面构建（网页、PWA、Mac）」并在后台确认 UI 1.3.1。若之前的构建已上传，选择新的构建号。
2. 在生产服务器交互终端运行下面两行。账号名可自选，重复使用已有名字会失败。命令创建普通用户和一本个人账本，在当前终端显示随机密码，妥善保存。

   ```bash
   cd /www/wwwroot/tbox/current/api
   node --env-file=/www/wwwroot/tbox/shared/api.env dist/identity/create-password-account.js ark_demo
   ```

3. 在上传的 iOS 构建点「登录 → 账号密码登录」，用新账号验证登录、退出及重新打开，安装送审涉及的子应用，准备示例数据。把普通账号和密码填入 App Store Connect「App 审核信息」。此账号与其他普通用户使用相同的 iOS 功能范围。客户端没有密码注册入口。

## 下次修复怎么跑

- **同一商店版本还在准备中**：继续用文件中同一个 `ios` 版本，在 GitHub 新点 **Run workflow** 获取新构建号。Apple 已接收的「版本＋构建号」不能覆盖。若上传步骤报网络错误，先去 Apple 查看那次构建是否已经收到。
- **已上线后发新功能或修复**：在根目录 `release-versions.json` 把 `ios` 改为更高版本并提交，例如 `1.2.1`。iOS 字段不占用 Mac、网页或子应用的版本号。
- **签名步骤失败**：检查是否使用 `ios-release`、P12 导出密码、证书私钥和描述文件选中的证书。换发证书后重新生成描述文件，把两个 GitHub Secrets 一起更新。
- **上传鉴权失败**：检查 Team Key 的 Key ID、Issuer ID 和 P8 是否来自同一组，App 记录是否在同一团队。**仓库仍看不到 Action**：先检查工作流是否已推送到 GitHub 默认分支。


## 验证子应用直达

主站和 iOS 包都要部署本次代码。完成第 1B 步后即可核对站点配置。确认主站的 `/.well-known/apple-app-site-association` 直接返回 HTTP 200 和 JSON，内含 `8BQ285B3J2.cn.tboxos.ark` 与 `/open.html`。目录统一使用 `https://tboxos.cn/open.html?app=todo` 这种链接，直接访问同一个静态文件，兼容 OSS。旧的 `/open/<appId>` 仍可由原生端接收。

在「备忘录」粘贴链接，用装了新包的 iPhone 点击，分别核对已安装子应用直达、未安装时显示应用详情、未登录时登录后继续。未装方舟时应显示共用引导页。iOS 商店上线后在管理后台配置 App Store 下载地址，引导页会读取该地址。
