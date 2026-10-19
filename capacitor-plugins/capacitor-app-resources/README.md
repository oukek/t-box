# App Resources

宿主独占的 Capacitor 插件，负责公开静态应用包的持久保存、SHA-256 校验、原子安装和隔离本地服务。应用只使用现有 App SDK，不直接访问此插件。

接口：`manifest`、`has`、`prepare`、`open`、`remove`、`progress`。`prepare` 接收经过宿主发布描述绑定的 HTTPS 基址、清单 JSON 与摘要，原生层独立校验清单摘要及全部文件。`open` 返回独立的回环地址，不能使用宿主同源的 `convertFileSrc` 代替。

Android/iOS 均不解压归档、不执行后端代码、不授予原生文件权限。后台版本发现、用户授权、后端生命周期、回退协调和启动诊断由宿主统一管理。详见 [资源架构](../../docs/application-local-resources.md)。
