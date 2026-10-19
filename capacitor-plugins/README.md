# Capacitor 本地插件

此目录已加入 pnpm workspace，子目录各自是独立插件包。

- `capacitor-app-resources`：应用静态资源下载、摘要校验、持久保存及隔离本地加载。
- `capacitor-wechat-pay`：原生微信支付桥接。
- `capacitor-native-scanner`：从参考项目迁入并适配 Capacitor 8 的扫码插件。

插件包通过 peerDependencies 使用宿主的 `@capacitor/core`，app 与 capacitor 都通过 `workspace:*` 引用。修改原生代码或添加插件后执行 `pnpm native:sync`。
