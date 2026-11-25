# 第 10 项 · 生产发布操作与验收单

已有生产网页版、首次上线桌面与 PWA，请从[按顺序部署的操作手册](first-desktop-pwa-rollout.md)开始。

执行人：生产发布管理员。适用渠道：macOS Apple Silicon；勾选网页选项时另验网页/PWA。本单按仓库现有工作流编写。生产状态为**待执行**，第 09 项的本地版本号和截图不能填作本次结果。

## 1. 确认发布起点

在旧 Mac 的「设置 → 系统版本」抄下实际界面版本、核心版本，截一张更新前的图。在后台「应用管理 → 系统发布 → 桌面端」记录当前生效组合。选定发布分支和 commit，确认线上 Actions 能检出这个 commit，包括当前验收过的桌面、API 和后台代码。留存上一份已批准的签名安装包。

| 起点 | 怎么走 | 何时能签收 |
| --- | --- | --- |
| 已有生产版，旧 Mac 能通过正式渠道检查 | 保留旧客户端，按下面流程发目标候选 | 从这台旧设备完成一次实际升级 |
| 首次上线，后台暂无桌面发布 | 首次用 `both` 发布基线 A，从正式入口在 Mac 安装 A，验证实际版本，保留这份安装。到下一次正式发布 B，重复第 4–7 步 | A 只能签收首次安装；A → B 成功后才能签收在线升级。要验自动重启，B 必须包含核心 |

生产确认会让符合版本条件的 Mac 立即查到目标，当前没有按测试账号灰度的开关。仅界面发布可以签收界面刷新路径；含核心的自动重启路径要在实际含核心发布时签收。

## 2. 核对域名、凭证和签名

| 位置 | 操作 | 通过条件 |
| --- | --- | --- |
| GitHub Actions / `desktop-release` Environment | 核对 Variables `DEPLOY_DOMAIN`、`OSS_REGION`、`TBOX_UI_PUBLIC_KEY`、`TBOX_CORE_PUBLIC_KEY`；Secrets `APP_IMPORT_TOKEN`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`TBOX_UI_PRIVATE_KEY`、`TBOX_CORE_PRIVATE_KEY` 及各自的 `TBOX_UI_KEY_PASSWORD`、`TBOX_CORE_KEY_PASSWORD` | 两套密钥各自配对，与已安装生产客户端信任的公钥一致；候选工作流和 PM2 工作流能取到对应凭证 |
| macOS 对外分发 | 核对 Variables `APPLE_SIGNING_IDENTITY`、`APPLE_TEAM_ID` 和 Secrets `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD` | 使用预期的 Developer ID Application 身份；第 4 步验证 Apple 签名及公证。含核心的生产候选缺少 Apple 配置会停止构建；上传前 CI 从更新归档中解压实际应用并验证团队、签名、公证票据与 Gatekeeper |
| 生产服务器 | 在已有的 `/www/wwwroot/tbox/shared/api.env` 补齐两份 `TBOX_*_PUBLIC_KEY` 的完整公钥内容、服务器端 OSS 凭证。自定义域名设置 `TBOX_DESKTOP_API_BASE=https://api.<生产域名>/api/v1` | API 可以读主站桶，服务器和 Actions 指向同一生产环境。保留已有 MySQL、OSS 和其他业务配置；签名私钥仅供构建使用 |

首次配置请按[方舟 macOS 签名与公证操作手册](macos-developer-id-signing.md)操作，包含 Apple 后台签发、钥匙串导出、GitHub 环境配置及首轮构建的通过条件。

## 3. 部署 API 和后台，记录发布前状态

1. 运行 Actions **后端部署（PM2）**，选择目标分支。已有环境勾选 `start_services`，检查数据库初始化和 PM2 启动步骤。首次服务器尚未配置时，先按 [PM2 首次部署步骤](api-pm2-deployment.md) 安装配置。通过条件是 PM2 服务在线，下面的健康检查返回 HTTP 200，`data.dependencies.mysql` 为 `up`。若状态是 `degraded`，检查列出的异常依赖并记录原因。
2. 运行 **前端与后台部署（OSS）**，本步选 `target=admin`。通过条件是从生产后台域名登录后能打开「系统发布」的桌面端列表，刷新无错误；首次可以是空列表。主站候选按第 8 步单独确认。
3. 从验收 Mac 所在网络执行下面的只读命令，记下旧设备在**发布前**收到的 HTTP 状态和计划编号。使用生产域名和真实版本替换示例。命令使用 curl 和 jq；响应里的临时签名地址不会打印。

```sh
API='https://api.tboxos.cn/api/v1'
OLD_UI='1.1.16'      # 替换为旧设备实际值
OLD_CORE='1.0.0'     # 替换为旧设备实际值
curl -fsS "$API/health" | jq '.data'
plan() {
  curl -fsS --get "$API/system-updates" \
    --data-urlencode platform=macos --data-urlencode arch=aarch64 \
    --data-urlencode "ui=$1" --data-urlencode "core=$2" \
    -o "$QA_DIR/plan.json" -w 'HTTP %{http_code}\n' || return 1
  if test -s "$QA_DIR/plan.json"; then
    jq '{id,notes,ui:(.ui|if . then {version,bytes,digest} else null end),core:(.core|if . then {version,bytes} else null end)}' "$QA_DIR/plan.json"
  fi
}
QA_DIR=$(mktemp -d)
plan "$OLD_UI" "$OLD_CORE"
```

首次无基线时，检查接口预期 204，安装入口预期 404。已有基线时，与线上版本相同的设备预期 204；更旧的设备可能已收到上一条 200 计划。沿用同一终端和同一组旧版本，便于比较确认前后结果。

## 4. 构建候选，确认前验货

运行 **桌面系统候选（macOS）**，选择同一 commit 所在的分支，填写给用户看的更新说明（1–1000 字）。

| 本次发布 | `components` | 版本输入 | `include_web` |
| --- | --- | --- | --- |
| 首发或同时更新界面、核心 | `both` | 两个组件分别填 `patch`、`minor`、`major` 或完整 `x.y.z` | 需要同版本网页时勾选 |
| 只更新桌面界面 | `ui` | 填 `ui_change`，`core_change` 保持默认 `patch` | 按需勾选 |
| 只更新核心 | `core` | 填 `core_change`，`ui_change` 保持默认 `patch` | 关闭 |

**通过条件**

- Actions 对应的预留、构建、签名、上传和登记步骤成功。保存运行链接及 commit。后台刷新后该条为「待确认」，顶部仍是旧组合。打开「审核发布」，逐项核对界面、核心、生效方式、说明，先点「取消」。
- 在主站 OSS 桶核对 `desktop-candidates/<build UUID>/` 的私有对象。仅界面本批一个 `.json`，仅核心一个 `.app.tar.gz`，联合两者都有。记录 UUID、对象大小及文件名中的 SHA-256。分别查看候选组件及基线，继承的组件使用原制品。重复第 3 步查询，仍应得到原结果。
- **含核心时**，用有读权限的 OSS 控制台下载本批私有归档到 Mac，核对下载文件的 SHA-256 与对象名一致，在空目录解压，执行下列命令。要求签名校验成功、TeamIdentifier 与预期团队一致、Gatekeeper 接受正式分发签名，公证票据校验成功。任一项不符，停在「待确认」。仅界面沿用已获批核心，可跳过本项。

```sh
# 在归档解压目录执行
codesign --verify --deep --strict --verbose=2 './T方舟.app'
codesign -dv --verbose=4 './T方舟.app' 2>&1 | grep -E 'Authority=|TeamIdentifier='
spctl --assess --type execute --verbose=4 './T方舟.app'
xcrun stapler validate './T方舟.app'
```

## 5. 正式确认，验证生产分发

1. 后台进入「桌面端 → 审核发布」，最后核对旧 → 新组合，点一次「确认发布」。通过条件为出现「桌面版本已发布」，该记录为「当前生效」，顶部版本正确。显示「基线已变化」时先刷新，基于新线上组合重新构建；若请求超时，先刷新核对谁已生效。
2. 再执行 `plan "$OLD_UI" "$OLD_CORE"`。对实际需要升级的旧设备预期 **200**，`id` 等于候选 UUID，说明与后台一致。按设备差量核对字段：仅需界面时 `core=null`，仅需核心时 `ui=null`，两者都旧时两项都有。目标版本和 `bytes` 与各自获批对象一致。
3. 将目标组合代入同一函数，例如 `plan "$TARGET_UI" "$TARGET_CORE"`（先设置这两个变量为后台实际值），预期 **204，无响应体**。只用支持的 `macos/aarch64` 做此判断，未支持的架构也会返回 204。
4. 用下面的安装入口从目标网络下载到临时目录。入口应返回 **302**，跟随后最终为 **200**，摘要应等于**当前获批核心**对象名的 SHA-256。首次安装时从该归档解压，将应用放入「应用程序」后打开。仅发界面时安装归档仍来自上次的核心构建，新安装可能先运行内置界面，再单独取得新版界面。

```sh
INSTALLER="$API/system-updates/macos/aarch64/installer"
curl -sS -o /dev/null -w '入口 HTTP %{http_code}\n' "$INSTALLER"
curl -fLsS -o "$QA_DIR/TBox.app.tar.gz" -w '最终 HTTP %{http_code}，下载 %{size_download} B\n' "$INSTALLER"
shasum -a 256 "$QA_DIR/TBox.app.tar.gz"
```

## 6. 在保留的旧 Mac 上执行一次更新

保存正在编辑的内容，保留旧安装，在「设置 → 系统版本」点击「检查更新」。截图需包含实际版本、目标版本和说明。开始前记录当前应用进程 PID（可用「活动监视器」），点一次更新，再截一张进度图。下载中按 Esc 或尝试关闭窗口，业务界面应保持锁定。联合更新时，两个组件共用弹窗和总进度。

| 设备实际收到的计划 | 完成条件 |
| --- | --- |
| 仅界面 | 按钮是「更新并刷新」。窗口重载，PID 不变，设置中仅界面版本变化 |
| 含核心 | 按钮是「更新并重启」。旧 PID 退出，新 PID 自动打开一个主窗口。全程只确认一次、重启一次，设置中两个实际版本均符合计划 |
| 已是目标组合 | 手动检查显示「已是最新版本」，无制品下载或重启 |

## 7. 对账并签收

在新版「设置 → 系统版本」再点一次检查，截下两个实际版本和「已是最新版本」。从同一台 Mac 读取客户端正式应用的数据目录：

```sh
jq '{last_release, active_ui:.active.version, pending, attempted}' \
  "$HOME/Library/Application Support/cn.tboxos.desktop/system/state.json"
```

成功在线升级后，`last_release` 应等于第 5 步计划的 `id`，`pending=null`，`attempted=false`。运行内置界面时 `active_ui` 可能为空，实际版本以设置页为准。首次直接安装没有经历在线升级，可没有该条成功记录。

下载量按**验收 Mac 的这一次更新**核对。预期值为本机计划中非空组件的 `bytes` 之和；若已启用 OSS 访问日志，按时间、对象、来源区分客户端更新、管理员检包及安装入口测试，记录实际响应字节和重试次数。缺少实际观测时填「仅核对计划大小」，保留下载量待核验。不要把临时签名 URL 或整个计划响应附入验收记录。

## 8. 同批网页 / PWA（仅勾选时）

桌面确认后，在「系统发布」的网页列表核对同一构建编号、界面版本和当前生效基线，再单独确认网页候选。确认前后均从用户网络读取**主站自定义域名**的标记：

```sh
WEB='https://tboxos.cn'  # 替换为实际主站
curl -fsS "$WEB/web-version.json" | jq '{build,version}'
```

通过条件是确认前仍为旧标记，确认后 `build` 和 `version` 匹配网页候选。用保留旧版的网页或已安装 PWA 正常打开，看到提示后点更新，等待资源加载完成，刷新后设置显示目标版本。若主站仍返回旧标记，核查自定义域名和 CDN 缓存，再从目标网络复测。只发桌面时，网页记录填「不适用」。

## 失败时停在哪里

| 现象 | 处理与复验 |
| --- | --- |
| API 健康异常、后台 404、候选登记鉴权或 OSS 读取失败 | 停在确认前，检查实际部署的 commit、导入凭证、桶权限、公钥。修正后重新检查健康、候选及旧计划 |
| 签名、公证、架构或摘要不匹配 | 保留旧版，修正制品并重新构建，重新审核 |
| 已确认但客户端下载失败 | 保留旧设备的错误截图、版本、时间和发布 UUID。重新检查获取新计划，核对生产 API、核心清单和私有 OSS 下载。从客户端重试后重新对账 |
| 已生效版本存在缺陷或新版核心无法启动 | 当前后台没有主动撤回入口。暂停后续推广，保留安装包和日志。界面启动失败时核对自动恢复后的版本；核心无法启动时用经签名、公证并验证过的修复安装包。修正发布使用更高的受影响组件版本，再走本单 |

## 本次生产记录

| 项目 | 实际结果 |
| --- | --- |
| 执行人、时间、Mac 系统 / 架构、来源网络 | 待填 |
| API / 后台 / 桌面 Actions 链接及 commit | 待填 |
| 发布模式、候选 UUID、原生效 UUID | 待填 |
| 旧设备界面 / 核心 → 目标 → 设置实际值 | 待填 |
| 确认前后计划、同版本响应、安装包摘要、公证结果 | 待填 |
| 客户端预期 / 实际下载字节、重试数、提示数、重启数 | 待填 |
| 更新前 / 下载中 / 更新后截图、原生 last_release | 待填 |
| 网页构建、主站域名、PWA 实测（如适用） | 待填 |
| 异常、复验、结论与签收时间 | 待执行 |

只有本次适用的生产证据齐全后，才将[总进度表](desktop-system-updates.md)第 10 项改为生产验收通过。
