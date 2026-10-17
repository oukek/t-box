# 微信 iOS / Android APP 支付

原生壳现在接入微信官方 OpenSDK，网页支付继续保留。微信产品里的 **Native 是 PC 扫码支付**；原生移动 App 用的是 **APP 支付**。

## 当前 iOS 充值策略

AI 余额充值在 iOS 原生壳中固定禁用，提示「iOS 应用内购暂时不可用」，充值和待支付订单的继续支付按钮置灰；余额、使用记录、余额明细和订单仍可查看。恢复旧订单只核对服务端状态，不调起支付。后台开启 APP 通道也不能开启 iOS 的 AI 余额充值。平台依据 Capacitor 原生平台判断，iPhone / iPad 浏览器仍按网页通道处理，Android 仍按 APP 通道处理。

此限制属于 AI 余额业务，不删除通用微信 SDK；后续内购应作为独立网关接入。iOS 充值页不展示外部充值网址、二维码或引导前往 Android / 网页购买的文案。关闭支付和去除外部购买引导不能保证整个应用通过审核；是否适用免费网页工具伴随应用等例外，需按完整产品功能和发行地区对照 [App Store 3.1.1 / 3.1.3](https://developer.apple.com/app-store/review/guidelines/#payments)。

## 配置位置

商户私钥、API v3 密钥、证书、公钥、商户号和移动应用 AppID：后台「支付管理 → 微信支付配置」，加密存入数据库，独立 APP 开关。原来的服务号 AppID / AppSecret 供 JSAPI 使用，不能替代移动应用 AppID。只做 APP 支付时可关闭 Native/H5/JSAPI，不需要填写服务号或网页地址；API 公网 HTTPS 地址仍必须提供，用于接收通知。

原生公开身份：`capacitor/wechat.config.json`，初始关闭，**不填写任何私钥、AppSecret 或 API v3 密钥**。

```json
{
  "enabled": true,
  "appId": "微信开放平台申请的移动应用AppID",
  "universalLink": "https://你的域名/wechat/",
  "iosTeamId": "你的Apple开发团队10位ID"
}
```

这是打包参数，不是服务器环境变量。原生 AppID 必须和后台的移动应用 AppID 相同。改变原生 AppID / Universal Link / 开关需要重新构建壳；后台调整不能改变已安装 App 的 URL Scheme 或原生签名。微信 SDK、付款认证和到账逻辑不交给 AI。

## 开通与注册

1. 在 [微信开放平台](https://open.weixin.qq.com/) 申请、审核通过移动应用；在商户平台开通 APP 支付并关联该移动应用 AppID。
2. Android 填写实际 `applicationId`（当前 `com.tbox.app`）及签名证书 MD5。Debug 与 Release 签名不同：测试包与正式包须分别匹配开放平台实际配置，或者使用官方支持的备用签名。不要通过关闭 SDK 签名验证解决调起失败。
3. iOS 填写实际 Bundle ID（当前 `com.tbox.app`）、Universal Link，选择实际 Xcode 开发团队，启用 Associated Domains 能力和对应签名配置。Universal Link 必须是专用 HTTPS 路径，末尾 `/`，例如 `https://app.example.com/wechat/`。不要填写示例 AppID。
4. 填好公开配置后运行 `pnpm --filter @t-box/capacitor sync:wechat`。脚本同步 iOS Release/Debug Info.plist、URL Scheme、微信查询 Scheme、Associated Domains entitlements 和 Android 资源/回调类，保留其他 URL handler / 关联域名。后台勾选「iOS / Android 原生 APP 支付」。
5. Universal Link 使用脚本生成的主站域名（`https://box.<DEPLOY_DOMAIN>`）时，**前端与后台部署（OSS）** 会按已启用的公开配置自动生成、合并并上传 `/.well-known/apple-app-site-association`，无扩展名、HTTPS 200、`Content-Type: application/json`、不重定向。其他业务的关联条目可先放入 `app/public/.well-known/apple-app-site-association`，发布时保留并合并。文件限定实际 Team ID + Bundle ID 和 `/wechat/*` 路径；原生工程仍需执行同步。使用其他 Universal Link 域名时，需要由该域名的运维另行托管文件，当前主站自动发布入口要求配置与生成的主站来源一致。
6. API 通知地址是后台公网地址 + `/api/v1/payments/webhooks/wechat`，必须让微信服务器可以访问。原生生产包同样需要正确的 `VITE_API_BASE_URL=https://你的API域名/api/v1`。

配置未完成时入口保持关闭。客户端会比较当前后台 APP AppID 与壳内 AppID；缺少微信时提示安装，不会自动降级到 H5。

## 构建与热更新

```bash
pnpm native:sync
pnpm native:run:android
pnpm native:run:ios
```

`native:sync` 会先同步版本及微信公开配置，再构建前端并将 dist 复制到壳、同步原生依赖。SDK 版本锁定在本地插件 Gradle / podspec；CocoaPods 使用 static linkage 集成官方静态 XCFramework。

开发调试：先 `pnpm dev`，再 `pnpm native:dev:android --url http://你的局域网IP:5173` 或 `pnpm native:dev:ios --url http://你的局域网IP:5173`。热更新仅替换 Vue 页面，SDK 和回调类仍来自真实壳。修改原生插件或公开身份后需要重新构建/安装；发行前运行 `pnpm native:sync` 清除开发服务器 URL。

改变 Android 包名或 iOS Bundle ID 时同时修改宿主工程/Capacitor appId 和微信开放平台。配置同步会从宿主工程读取标识，生成对应 Android wxapi 类与 iOS AASA。Android 回调 Activity 使用 `${applicationId}.wxapi.WXPayEntryActivity` 占位符，且没有 intent-filter（兼容 Android 13+ 微信显式回调）。

## 支付与恢复

1. 客户端创建本地订单；首次 intent 锁定 `payment_mode=app`，订单绑定不可变的商户配置版本。
2. 后端 `POST /v3/pay/transactions/app`，使用移动应用 AppID；RSA 二次签名字符串为 `appid\n时间戳\n随机串\n原始prepay_id\n`。APP 的 `packageValue` 固定 `Sign=WXPay`，和 JSAPI 的签名不同。
3. 仅签好的短期支付参数进入 Capacitor 桥；iOS 使用启动时注册的 AppID，Android `PayReq.appId` 使用同一个 AppID。
4. SDK 调起结果、SDK 回调和前台恢复只触发后端查单。回调取消后可以查看、继续原订单，支付中断不会把订单伪造为已支付。
5. 后端检查可信签名、解密、订单固定的 AppID/商户号/交易类型/金额/币种/支付时间和微信流水，事务内幂等到账。客户端、后台都没有“标记成功”接口。
6. 原生端按登录用户在 localStorage 保留待核对订单 ID（不是认证凭证）；冷启动且身份恢复成功后，仍待支付的订单自动打开余额页并核对。离线或存储不可用不阻止应用其他功能，也可从订单列表恢复。服务端通知不依赖 App 存活。

## 验证范围与发行

`pnpm test:wechat` 覆盖 locally signed APP 下单、原始 prepay_id 二次 RSA 签名、错误服务号 AppID/交易类型拒绝、查单和重复通知一次到账、密钥轮换及 APP-only 配置。`pnpm test:native` 覆盖配置校验/URL scheme 轮换/AASA 路径/构建同步。iOS 模拟器编译和 Android Debug APK 编译可在没有真实商户凭证时完成；模拟器不能替代微信真机支付联调。

当前未提供真实移动 AppID、域名验证、签名证书和商户开通状态，因此不宣称已完成真实调起、付款、到账验证。正式上线前用匹配签名的 iOS / Android 真机验证成功、取消、微信未安装、应用后台/被杀、重复通知、网络中断恢复等情况。

AI 余额是用于应用内数字服务的充值。[App Store 3.1.1](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase) 通常要求内购，部分地区的外部支付规则另有条件；[Google Play 支付政策](https://support.google.com/googleplay/android-developer/answer/9858738) 也要求符合其内购或地区替代支付计划。接入 OpenSDK 不代表获得商店支付豁免。当前通道默认关闭，发行渠道确认后再开启；未来 Apple IAP / Play Billing 可以作为独立支付网关接入既有钱包结算边界。

参考：[APP 下单](https://pay.wechatpay.cn/doc/v3/merchant/4013070347)、[APP 调起支付](https://pay.wechatpay.cn/doc/v3/merchant/4013070351)、[APP 二次签名](https://pay.wechatpay.cn/doc/v3/merchant/4012365340)、[iOS OpenSDK](https://developers.weixin.qq.com/doc/oplatform/Mobile_App/Access_Guide/iOS.html)、[Android OpenSDK](https://developers.weixin.qq.com/doc/oplatform/Mobile_App/Access_Guide/Android.html)。
