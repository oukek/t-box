# 推广渠道与个人分享

后台「推广渠道」管理渠道名称、宣传途径说明和启停状态，支持复制专属推广链接、预览和下载带二维码的海报。改名不改变链接。后台「用户与额度」显示个人推广带来的注册人数、付费人数、支付总金额、成功退款和净支付金额。

网页桌面侧栏与移动端底部导航提供「分享」入口。登录后弹出个人专属海报，可以长按保存、复制链接或下载。二维码仅包含随机推广标识，不包含用户 ID、OpenID、昵称或登录凭据，由服务器关联分享人。

## 统计口径

- 每个新账号最多一个直接推广来源，可以是渠道或用户；不做多级归因。
- 只在微信账号首次创建时归因，与创建账号在同一数据库事务中提交。已有账号再次扫码、登录和支付均不补记、不覆盖来源，历史用户不回溯。
- 注册前，浏览器保留首次捕获的合法格式推广标识，最长 30 天。登录发起后绑定到服务器授权流程，OAuth 回跳不丢失来源。
- 电脑扫码登录时，微信扫描流程继承电脑端来源；扫描端不能替换电脑端来源。
- 无效、停用渠道或分享人已停用时不产生新归因。停用渠道保留历史统计。
- 注册数按新账号计数，不按访问、扫描或授权次数计数。
- 支付总金额累计这些新用户所属订单的全部成功支付，不限首单。为他人付款时，仍按订单所属账号确定推广来源。
- 退款只计算成功退款；净支付等于成功支付总额减成功退款总额。待支付、关闭订单和未成功退款不计入。
- 金额从已确认订单和退款独立聚合，以整数分计算；重复回调不重复累加，多笔退款不放大支付金额。

## 微信分享配置

微信内登录后配置朋友与朋友圈分享数据：统一标题、描述、300 × 300 缩略图和个人推广链接。配置成功不代表用户已完成分享。分享和支付共用 SDK 加载器，同时保留三个接口；iOS 使用文档最初进入时不含 hash 的 URL 签名。退出或切换账号时恢复通用分享链接。

签名使用后台「微信登录」的公众号配置，与支付是否开启无关。上线时需配置该公众号的 **JS 接口安全域名**、具备相应接口权限，并满足服务器出口 IP 白名单要求。真实微信菜单分享需在配置域名的微信客户端验收。SDK 不可用时，海报与复制链接仍可使用。

## 数据库与发布

增量扩展 `2026-10-28-promotion-attribution` 新增 `promotion_sources`、`promotion_registrations`、`promotion_login_flows`。注册归因表以用户 ID 为主键，登录流程清理时级联清理临时来源记录。

发布 API 前执行 `pnpm db:init`，仅添加扩展，不清空数据，不补写历史归因；API、网页和后台需一同发布。`api/assets/` 已加入生产包 files，PM2 / Docker 打包时会包含海报模板与缩略图。

海报使用内置 imagegen 编辑已确认的第二版，预留底部二维码位；程序用 qrcode 生成真实二维码后通过 sharp 合成。模板 1080 × 1920，二维码位置 `(760, 1625)`，尺寸 232 × 232，包含四模块白边。

## 接口

- 管理员：`GET/POST /api/v1/admin/promotions/channels`，`PATCH /api/v1/admin/promotions/channels/:id`。分页每页 50 条，支持搜索，修改须携带 revision，沿用管理员鉴权与 CSRF 检查。
- 管理员用户列表：`GET /api/v1/admin/billing/users`，增加 promotion 统计。
- 登录用户：`POST /api/v1/promotions/me`，创建或读取当前账号固定推广链接。
- 登录用户：`POST /api/v1/promotions/js-sdk`，只允许签名已配置前端网站下不含 hash 的 URL。
- 公开海报：`GET /api/v1/promotions/:token/poster.png`，附加 `?download=1` 下载。
- 分享缩略图：`GET /api/v1/promotions/thumbnail.jpg`。

## 验证

`api/test/promotions.integration.ts` 在可丢弃 MySQL 数据库验证首次注册、已有账号不补记、并发注册、电脑扫码来源继承、个人固定链接、渠道冲突与停用、权限、多笔支付、重复通知及退款统计。`api/test/promotions.test.ts` 对合成海报解码，核对完整推广链接和图像尺寸。`app/test/promotions.test.ts` 验证来源持久化、过期和清除、iOS 签名 URL、分享与支付接口同时保留以及退出后恢复通用链接。

运行示例：

```bash
pnpm --filter @t-box/api exec tsx --test test/promotions.test.ts
MYSQL_DATABASE=t_box_test_promotions pnpm db:init
MYSQL_DATABASE=t_box_test_promotions pnpm --filter @t-box/api exec tsx test/promotions.integration.ts
pnpm --filter @t-box/api exec tsx --test '../app/test/promotions.test.ts'
```
