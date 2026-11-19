# T方舟采集插件

版本 0.3.1。仅在 `https://www.dianxiaomi.com/*` 显示页内采集箱，读取用户已登录的店小秘采集列表。原平台页面识别、商品卡片按钮、平台详情抓取、平台适配目录及参考插件分析文件已移除。商品的来源平台名称和原链接属于返回资料，仍在预览/导出中保留，不据此访问商品详情。

## 安装与使用

```sh
pnpm install
pnpm --filter @t-box/product-collector check
pnpm --filter @t-box/product-collector run pack
```

安装包：`output/collector-releases/tark-collector-0.3.1.zip`。解压后，在 Chrome 扩展管理中打开开发者模式并加载解压目录；开发时可直接加载 `extensions/product-collector/dist`。更新插件后刷新原网页。未发布 Chrome Web Store。

1. 登录店小秘，进入采集箱页面，点击右下角“T方舟 · 采集箱”。
2. 点击“读取此页”。支持按名称搜索、20/50/100 条分页、上一页/下一页、指定页码和从当前页连续导入。
3. 连续导入顺序请求，每页成功后保存；停止在当前页结束后生效。遇到错误或空间上限即停止，之前成功导入的商品保留。
4. 在预览中筛选、多选，打开详情弹窗核对资料、图片、视频链接、规格价格、属性和包装，导出全部或选中商品。
5. 移除只清理插件临时预览，不修改店小秘记录。

商品仅存在 `chrome.storage.session`，关闭浏览器/重载扩展后不保留。最多 200 件、约 7 MB；超过容量时整页导入失败，不部分覆盖该页、不静默淘汰已有商品。导出格式 `tark.collector.products` v1；媒体是来源链接，不包含文件二进制。尚未接方舟后端。

## 请求与字段

后台通过 `chrome.scripting.executeScript` 在来源店小秘标签页的 MAIN world 执行 `POST /api/crawl/list.json`。请求体使用 `URLSearchParams`，保留 pageNo、pageSize、site=all、searchValue、productSearchType=name 及用户示例中的空筛选字段。不手动复制 headers；浏览器设置表单 Content-Type 和当前会话 Cookie，`credentials: include`。不新开标签页，也不读取或导出 Cookie。

响应必须 `code === 0`，包含有效 `data.page.list` 和匹配的分页信息。登录 HTML、业务错误、网络失败及分页异常均报错。失败状态商品跳过并说明；嵌套 JSON 格式错误标注缺失，其他字段仍可预览。

- 标题 name；原文描述 description/detail；详情 HTML 仅通过隔离 DOMParser 提取文本、图片，不在 UI 执行或直接渲染 HTML。
- 主图 imgUrl/previewImgUrl、详情图、规格图、视频、尺码表、说明文件分别标记来源。
- variant、attribute、packageInfo 等 JSON 字符串单独解析。规格保留选项、ID、价格、库存、图片；原始规格尺寸重量保留在商品结构数据中。
- 优先 sourcePrice + sourceCurrency、sourceDiscountPrice；缺少来源价格时使用 price + currency，币种缺失不猜测。sourcePriceUsd 等原值保留用于核对。
- 记录 ID 优先 idStr，拒绝不安全整数作为唯一标识。去重键优先来源平台 + productId，无来源编号时用店小秘记录 ID。重复读取更新已有商品，同页重复也只保留一份。
- 包装数值保留原值，不猜测接口未声明的单位。资料齐全仍标记“待核对”。

原始商品结构采用字段白名单，不保留 puid、createId、createName、updateId、updateName、权限、账户信息等业务元数据。接口样例原文件不打包、不提交。

## 架构与权限

```text
src/dianxiaomi/  请求参数、站点范围、列表响应解析与字段映射
src/extension/  页内入口、请求调度、隔离 HTML 解析
src/core/       商品类型、会话合并去重、导出
src/ui/         预览工作台与商品详情弹窗
```

权限仅 scripting、storage、offscreen 和 `https://www.dianxiaomi.com/*`。内容脚本和可嵌入资源也只允许该地址，不申请其他站点权限。媒体预览会加载商品响应中给出的图片地址。

## 格式化与验证

复用根目录 `@antfu/eslint-config`；不另用 Prettier。构建不压缩 JS/CSS。

```sh
pnpm --filter @t-box/product-collector format
pnpm --filter @t-box/product-collector check
```

测试覆盖嵌套规格、来源币种、零值、安全整数 ID、图片和属性、去重更新、分页与失败响应、域名边界、敏感字段排除、容量原子性。真实店小秘接口仍受用户登录和服务端状态影响；模拟响应测试不代表登录会话下的线上接口已经验收。


0.3.0 验证记录：7 项单元测试通过；独立 Chromium 加载扩展，以用户提供的三件商品响应模拟接口，验证首次导入三件、规格分别 2/75/1 条、重复及跨页更新仍三件、详情弹窗、名称参数、连续翻页、停止、错误后保留、JSON 导出、390px 布局无横向溢出，以及其他站点不注入。请求检查确认 POST、自动表单 Content-Type、测试会话 Cookie 和无新增标签页。未使用用户真实登录会话调用线上接口。


## 0.3.1 商品页式预览

商品详情改为桌面左右布局：左侧主图与缩略图，右侧标题、来源价格、库存和规格选择。规格支持价格/库存/图片联动，多规格默认显示前八项，可搜索或展开。下方连续展示商品参数与详情图，保留全部规格表、媒体来源链接、采集检查及结构化数据折叠区。未获取的价格和库存不以商品汇总值替代。移动端采用全屏纵向布局，标题与关闭/导出操作固定可用。

7 项回归测试、格式检查、类型检查和构建通过。独立 Chromium 使用样例响应验证：11 张详情图连续展示、规格价格/库存/图片联动及清除选择、缩略图切换、内容导航、75 条规格展开与搜索、390px 下无横向溢出且底部操作可见、Esc 关闭。
