# 微信 APP 支付 Capacitor 插件

本地原生桥接，Android 使用腾讯官方 `wechat-sdk-android:6.8.40`，iOS 使用官方 `WechatOpenSDK-XCFramework:2.0.9`。不依赖社区支付插件，不包含 UI 或商户密钥。

- `getStatus()`：读取打包的公开配置与微信安装状态；网页返回不可用。
- `pay(serverParameters)`：校验壳 AppID 和后端下单 AppID 一致，发送 `PayReq`。返回 `launched` 仅表示 SDK 已接受调起。
- `paymentResult`：SDK 提示（0 成功提示，-2 取消，其他失败）；**不作为到账依据**。
- `foreground`：回到前台后提示重新核对服务端订单。

同一插件实例最多同时调起一次支付，回调后解除，未收到回调时 2 分钟后允许重试。不承诺 SDK 回调必达；进程被杀时回调可能发生在 bridge 初始化前。前端按用户保留原订单 ID，登录恢复后从服务端查询。

iOS SDK 启动注册及 URL / Universal Link 转交由 `TBoxWechatPayDelegate` 统一处理，AppDelegate 与 SceneDelegate 都接入；Android 由宿主 `{applicationId}.wxapi.WXPayEntryActivity` 继承插件的回调 Activity，`handleIntent` 使用官方 SDK 验证微信签名，且不配置 intent-filter。

配置与真机联调见 [原生支付说明](../../docs/wechat-native-payments.md)。
