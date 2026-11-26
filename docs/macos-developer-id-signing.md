# 方舟 macOS 签名与公证操作手册

已有生产网页版、首次上线桌面与 PWA，请从[按顺序部署的操作手册](first-desktop-pwa-rollout.md)开始。

适用于从方舟官网或 OSS 分发的 Apple Silicon 桌面版。第一次由团队在 Apple 创建签名身份，在 GitHub 保存凭证。以后发布含核心的版本时，GitHub Actions 自动签名、提交 Apple 公证、验证最终归档，再登记方舟候选。最后由管理员在方舟后台确认上线。此流程无需在 App Store Connect 创建商店应用、准备商店素材或提交上架审核。[Apple 站外分发说明](https://developer.apple.com/developer-id/) · [方舟桌面工作流](../.github/workflows/desktop-release.yml)

## 1. 在 Apple Developer 确认团队和权限

1. 打开 [Apple Developer Account](https://developer.apple.com/account/)，点击 **Sign in**，使用开发者账号登录并完成双重认证。
2. 若账号属于多个团队，在团队选择器选方舟对外发布所用的团队。进入 **Membership details（会员资格详情）**，记下团队名称、**Team ID** 和会员有效状态。后面的证书、签名身份、公证账号都要对应这个团队。Team ID 用于 GitHub 的 `APPLE_TEAM_ID`。[Apple 对 Team ID 的说明](https://developer.apple.com/help/glossary/team-id/)
3. 若只有普通开发者账号，先从 [Apple Developer Program 注册入口](https://developer.apple.com/programs/enroll/) 点 **Start Your Enrollment**，按个人或组织的实际主体申请，待会员生效再继续。选择组织主体时按 Apple 要求准备组织信息及授权资料。
4. 本手册用本机生成私钥的方式申请 Developer ID。让团队的 **Account Holder（账户持有人）** 操作第 3 节；个人会员本人就是账户持有人。如果团队已有可用的 **Developer ID Application** 身份和对应私钥，可直接转第 4 节复用。[Apple 证书角色及申请说明](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)

**完成标志**：已确定正式发布团队，持有人可以进入 **Certificates, Identifiers & Profiles（证书、标识符与描述文件）**。本流程的 Apple 后台操作集中在证书页面和 Apple 账户安全页面。

## 2. 在 Mac 上生成证书请求文件

在将来要导出签名身份的那台 Mac 上操作。生成请求时，配对私钥留在这台 Mac 的钥匙串中。

1. 用 Spotlight 搜索并打开 **钥匙串访问（Keychain Access）**。
2. 在屏幕顶部菜单选择 **钥匙串访问 → 证书助理（Certificate Assistant）→ 从证书颁发机构请求证书（Request a Certificate From a Certificate Authority）**。
3. **用户电子邮件地址**填申请人的邮箱；**常用名称（Common Name）**填便于辨认的名称，例如 `TBox macOS distribution`；**CA 电子邮件地址**留空。
4. 在请求方式中选 **存储到磁盘（Saved to disk）**，点 **继续**，将文件保存到能找到的目录。下一步上传的是扩展名为 `.certSigningRequest` 的文件。[Apple 创建 CSR 的操作说明](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/)

## 3. 在 Apple 开发者后台签发证书

1. 账户持有人登录后，进入 **Certificates, Identifiers & Profiles → 左侧 Certificates（证书）**。也可直接打开[证书列表](https://developer.apple.com/account/resources/certificates/list)。
2. 点击证书列表上方的 **＋**。在 **Software（软件）** 分类选择 **Developer ID Application**，点 **Continue**。这个类型用于签署方舟的 `.app`。同页的 **Developer ID Installer** 用于 `.pkg` 安装器；当前方舟交付的是包含 `.app` 的 `.app.tar.gz`。[Apple Developer ID 证书类型](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)
3. 如果页面询问 **Developer ID Certificate Intermediary**，本项目的现代 macOS 构建环境选 **G2 Sub-CA (Xcode 11.4.1 or later)**。[Apple 对中间证书的说明](https://developer.apple.com/help/account/certificates/replace-developer-id-certificates)
4. 在上传请求页面点 **Choose File**，选第 2 节保存的 `.certSigningRequest`，点 **Continue**。生成后点击 **Download**，得到 `.cer`。记下证书到期日，供以后续签使用。[Apple 签发与下载步骤](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)

**完成标志**：所选团队的证书列表出现 Developer ID Application 证书，且本机已下载 `.cer`。后续公证由 Actions 提交，无需在证书后台为每个版本重复申请。

## 4. 安装证书，导出 CI 所需的 .p12

1. 回到**生成 CSR 的同一台 Mac、同一用户**，双击 `.cer`。若提示选钥匙串，选择 **登录（login）**。
2. 打开 **钥匙串访问 → 登录 → 我的证书（My Certificates）**，找到 `Developer ID Application: 团队名称 (TEAMID)`。展开左侧三角，确认下面有一项**专用密钥**。如果只有证书，先找回原 Mac 或已有的签名身份备份。
3. 在终端运行下面的命令，从结果中复制完整的 `Developer ID Application: … (…)`，保留冒号、空格和括号，去掉外层引号。这是 `APPLE_SIGNING_IDENTITY` 的值。核对括号里的团队 ID 与第 1 节一致。

   ```sh
   security find-identity -v -p codesigning
   ```

4. 在「我的证书」选中上一步的身份及其私钥，通过 **文件 → 导出项目**（或右键导出），格式选 **Personal Information Exchange (.p12)**。例如保存为 `DeveloperID.p12`。设置一个非空导出口令并保存到团队密码管理器；若随后弹出钥匙串授权框，按提示输入本机凭据。GitHub 所需的是刚设置的 **.p12 导出口令**。
5. 在文件所在目录执行下列命令，将无换行的 Base64 复制到剪贴板。到第 6 节粘贴进 GitHub Secret。保留一份加密的 `.p12` 备份；Base64 值含私钥，按私钥保管。[Tauri 在 CI 中使用签名证书](https://v2.tauri.app/distribute/sign/macos/)

   ```sh
   openssl base64 -A -in './DeveloperID.p12' | pbcopy
   ```

## 5. 在 Apple 账户后台生成公证专用密码

1. 使用有权为该团队提交公证的 Apple 账号登录 [Apple 账户管理](https://account.apple.com/)。账号须启用双重认证。
2. 进入 **登录与安全（Sign-In and Security）→ App 专用密码（App-Specific Passwords）**。
3. 点击生成按钮 **Generate an app-specific password**；若要求说明用途，填 `TBox GitHub macOS Notarization`，按页面提示验证身份。
4. 把生成的专用密码保存到密码管理器，稍后填入 `APPLE_PASSWORD`。登录这个账号使用的邮箱填入 `APPLE_ID`。此处使用专用密码，日常 Apple 登录密码继续由持有人保管。重置 Apple 账号主密码会撤销原有专用密码，届时重新生成并更新 GitHub Secret。[Apple 专用密码说明](https://support.apple.com/zh-cn/102654) · [Tauri 公证凭证说明](https://v2.tauri.app/distribute/sign/macos/)

## 6. 在 GitHub 的 desktop-release 环境填写凭证

打开**方舟仓库**，进入 **Settings → Environments → desktop-release**。如果环境还不存在，点 **New environment**，输入准确名称 `desktop-release`，再点 **Configure environment**。在 **Environment variables** 点 **Add environment variable**，在 **Environment secrets** 点 **Add environment secret**，按下表分别保存。[GitHub 环境配置](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

| GitHub 类型 | 名称 | 从哪里取 |
| --- | --- | --- |
| Variable | `APPLE_SIGNING_IDENTITY` | 第 4 节终端输出的完整 Developer ID Application 名称 |
| Variable | `APPLE_TEAM_ID` | 第 1 节会员详情里的 Team ID |
| Secret | `APPLE_CERTIFICATE` | 第 4 节从 .p12 复制的 Base64 全文 |
| Secret | `APPLE_CERTIFICATE_PASSWORD` | 第 4 节导出 .p12 时设置的口令 |
| Secret | `APPLE_ID` | 第 5 节公证账号的邮箱 |
| Secret | `APPLE_PASSWORD` | 第 5 节生成的 App 专用密码 |

**完成标志**：环境页面能看到以上六个名称，其中两个是 Variable、四个是 Secret。Secret 保存后 GitHub 隐藏值，发现误填时用 **Update** 重新录入。方舟还使用独立的 `TBOX_UI_*` 和 `TBOX_CORE_*` 密钥给更新包签名、验签；首次部署时也要核对它们，以及服务器公钥、OSS 和候选登记凭证。[生产验收单第 2 节](production-system-release-acceptance.md#2-核对域名凭证和签名)

## 7. 跑第一次 Actions，看哪一步代表成功

1. 确认含签名校验的代码已进入要发布的分支。打开 **Actions → macOS 整包发布（内置本次界面）→ Run workflow**，选分支。首次发布用联合发包；工作流读取该分支 `release-versions.json` 中的组件版本。整包同时登记网页和桌面候选。
2. 打开该次运行的 **candidate** 作业。查看 **构建并签名桌面核心**：Tauri 使用导入的签名身份签署应用，使用公证账号提交 Apple 公证并装订票据。Apple 接受后，继续看下一步。
3. 查看 **验证归档中的 Developer ID 签名与公证票据**：工作流解压最终发给用户的归档，验证应用签名、Developer ID 身份和 Team ID，再运行 `xcrun stapler validate` 及 Gatekeeper 检查。**此步骤通过**才继续上传。以后只发布桌面界面时选 `ui`，Apple 核心构建和公证步骤会跳过。
4. **上传私有制品并登记待审核版本**通过后，方舟后台 **应用管理 → 系统发布 → 桌面端**应出现对应的「待确认」记录。此时记下 Actions 链接和 commit。管理员按验收单核对候选，再确认发布、验证安装入口并在旧 Mac 上实际升级。[工作流源码](../.github/workflows/desktop-release.yml) · [生产确认与验收单](production-system-release-acceptance.md)

## 常见卡点

| 看到什么 | 先检查什么 |
| --- | --- |
| Apple 后台没有创建 Developer ID Application 的选项 | 核对当前团队和有效会员身份；本手册的手动 CSR 签发步骤由 Account Holder 执行 |
| 安装 .cer 后找不到私钥，无法导出 .p12 | 在生成 CSR 的 Mac 登录原用户，检查 login 钥匙串的「我的证书」。若原私钥丢失且无备份，需用新 CSR 申请配对证书 |
| 本机有证书，CI 却找不到签名身份 | 对照完整身份名称、证书有效期和 Team ID；核对 Secret 是含私钥的 .p12 的 Base64，并使用对应的导出口令 |
| 公证提示认证失败或无权访问团队 | 核对 Apple 账号、团队和 App 专用密码；若主密码刚重置，重新生成专用密码。若错误指向协议待接受，由持有人登录开发者账户检查协议 |
| 公证被拒，或归档的票据校验失败 | 在 Actions 展开公证日志，保留 submission ID 和错误内容；按 Apple 报告修正签名或制品，重新构建并验证归档。保持候选待确认，直至验证通过 |
| 已发布后需要换证 | 在原团队申请或复用有效 Developer ID Application 身份，更新 GitHub 的身份名称、证书和导出口令；如果只更换 Apple 证书，继续沿用原有方舟更新密钥。使用已安装的生产旧版验证下一次含核心升级 |

完成一次真实公证后，把运行链接、commit、签名团队、归档验证结果和旧版升级截图写入生产验收记录。证书私钥和密码只保存在团队受控位置。
