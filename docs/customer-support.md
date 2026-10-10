# iOS 微信客服入口

后台「客服配置 → 编辑配置」填写可直接访问的 HTTPS 二维码图片地址，勾选「开放 iOS 客服入口」。配置使用独立 TypeORM 表 `support_settings` 存储，记录最后修改管理员和时间；未配置或关闭时不展示入口。二维码需使用真实客服图片，项目不生成虚假联系方式。

iOS 原生首页右上角显示「联系客服」，点击后以弹窗展示「微信客服」二维码及保存识别提示。Android 和网页不展示，也不请求客服配置；iPhone Safari 属于网页端。图片加载失败和配置加载失败均提供重新加载，失败不影响 AI 会话。切换首页时更新配置，切换其他页面时关闭客服弹窗。

配置 API 与 AI、工具、账本和支付模块独立：登录用户读取 `GET /api/v1/support`，后台管理员读取 `GET /api/v1/admin/support`，修改 `PATCH /api/v1/admin/support`。二维码图片仅用于展示，不作为支付请求、认证凭据或模型上下文。iOS 充值禁用策略仍生效。

此实现不构成 App Store 合规保证。是否涉及外部购买引导需按实际客服流程判断，不能仅因移除「获取额度」文案或把入口放在首页而认定合规。规则参考 [App Store 3.1.1 / 3.1.3](https://developer.apple.com/app-store/review/guidelines/#payments)。
