# 运行、备份与恢复

后台「任务与运行记录」显示近 24 小时概况、分页任务列表和逐次模型调用。任务详情可以查看脱敏输入输出、模型/服务商、费用、重试与底层错误；普通异常概况仍仅含故障元数据。管理员接口不返回任务检查点、认证哈希或原始资源。详细配置与记录语义见 [模型池与任务审计](ai-model-pools.md)。

每个 HTTP 响应带 `X-Request-Id`，可用于关联 Fastify/PM2 日志。模型异常通过持久 `operations_events` 关联 `agent_tasks`、`agent_task_tools`、`billing_usage`。正常等待前端、用户取消与服务关闭不算模型异常。告警目前显示在管理后台；没有自动向外部群聊或个人发送通知。

## 手动质量门禁

`Quality` 工作流只允许手动运行，使用临时 MySQL 8.4 和 Redis 7，完成静态检查、所有项目构建、单元测试、运维脚本测试、从空库迁移、串行集成测试及桌面/移动尺寸 Chromium 验收。浏览器检查登录、OS 导航、设备/恢复设置、资源容量和断网静态页面重载。业务集成套件使用本地模型/微信替身，不会执行付费模型或真实支付。CI 安装 MySQL 客户端后，备份套件还实际执行 mysqldump→加密→暂存校验→新库导入；本地缺少客户端时明确 SKIP，CI 缺少时失败。

本地可先显式选择隔离数据库；环境变量优先于 api/.env：

```sh
MYSQL_DATABASE=t_box_test_acceptance pnpm db:init
MYSQL_DATABASE=t_box_test_acceptance pnpm test:integration
pnpm test:operations
```

不要将生产 MySQL 地址/账号填入测试环境。测试入口检查库名，但库名检查不能替代部署隔离和专用测试账号。

## 加密备份

工具在源码的 `scripts/operations-backup.mjs`，也随 PM2 发布包放入 `control/operations-backup.mjs`。需要服务器上安装 MySQL 8 的 `mysqldump` 和 `tar`。备份包含 SQL（事务表一致性快照、存储过程、触发器、事件）、shared/api.env、secrets 和 release-info；旧版遗留 storage / app-artifacts / app-deployments 存在时也会纳入保护。日志与可重新获取的运行包不包含在备份中；需要另外保留对应版本的发布包。

业务文件现存 OSS `tboxos/uploads/resources/`，服务器备份不包含远端对象。必须另外保留该前缀的对象备份 / 版本，并与数据库的相对路径记录对应恢复；不要给该前缀配置自动过期规则。网站发布不会清空它。更换 Bucket / 地域需要迁移对象和数据库位置，不能只改环境变量；生产不再读取本地后端，旧文件须先迁移并校验 OSS；恢复旧备份后也先完成迁移，再开放业务。

备份使用 AES-256-GCM 加密并认证，内部清单校验所有文件 SHA-256/大小。密钥与备份分开存放，不能把 provider.key 当作备份密钥，也不能把明文备份或备份密钥放到公开静态站点。加密后的归档放在 tboxos/uploads/resources/backups/，生产 create 命令要求使用 oss:// 输出地址，不在服务器保留归档。

首次单独生成密钥（已有密钥不能覆盖）：

```sh
node -e "require('node:fs').writeFileSync('/root/t-box-backup.key',require('node:crypto').randomBytes(32).toString('hex'),{flag:'wx',mode:0o600})"
```

先临时禁止业务写入和 CI 应用提交，停止 API 与恢复 worker，确认没有其他写进程；再执行备份。`--quiesced` 是操作员确认已经停止写入，脚本不会代为停止服务。文件和数据库同时备份不能只依赖 mysqldump 的事务快照。

```sh
pm2 stop t-box-api t-box-worker
node "$release/control/operations-backup.mjs" create "$release" oss://tboxos/uploads/resources/backups/t-box-20261017.tbox /root/t-box-backup.key --quiesced
pm2 start t-box-worker t-box-api
```

OSS 对象不覆盖同名备份，每次使用唯一名称；上传附带 Content-MD5 供 OSS 校验。上传完成或失败均清理临时归档，失败不声称备份成功。命令行和清单不包含数据库密码；mysqldump 使用权限 600 的临时配置文件。创建完成后工具会自行解密验证一次。所有临时明文文件位于权限 700 的目录，正常退出/失败时清理；硬关机、SIGKILL 后须清理系统临时目录中的残留。建议使用加密磁盘，并定期做隔离恢复演练。

## 隔离恢复演练

先在隔离机器或新目录验证，禁止直接覆盖运行环境：

```sh
restore_tmp="$(mktemp -d)"
trap 'rm -rf -- "$restore_tmp"' EXIT
# 将地域和文件名替换为实际值，只下载加密归档。
curl -fL https://tboxos.oss-cn-hangzhou.aliyuncs.com/uploads/resources/backups/t-box-20261017.tbox -o "$restore_tmp/backup.tbox"
node "$release/control/operations-backup.mjs" stage "$restore_tmp/backup.tbox" /root/t-box-backup.key "$restore_tmp/staged"
```

stage 在认证通过之后才解包，拒绝符号链接和路径穿越，拒绝覆盖已有目标，核对文件清单。它不执行 SQL、不启动 PM2，也不会覆盖现有密钥或配置。

演练步骤：

1. 在隔离 MySQL 创建新的演练库；以私有 MySQL defaults 文件导入暂存目录的 database.sql。不要导入到现有业务库。
2. 将暂存 shared 复制到演练部署根目录；保留原 provider.key，修改演练 api.env 的数据库、Redis DB、支付回调和域名，禁止接触真实支付与真实模型。
3. 解压备份对应 release-info 版本的运行包，执行 prepare-release，核对启动路径和 Node 架构。
4. 启动后验证健康、登录、受保护资源授权、文件读取、应用版本、钱包总账与任务凭据。确认恢复任务不会使用真实支付/模型配置意外发起请求，可先设置 TASK_WORKER_MODE=disabled 且不启动独立 worker。
5. 记录备份时间、恢复耗时、核对项目与失败原因。只有验证通过后才能安排正式维护窗口。

生产恢复仍由操作员明确选择目标并执行。自动导入 SQL/替换密钥容易造成不可逆的数据错配，因此工具将验证和暂存做成可重复步骤。
