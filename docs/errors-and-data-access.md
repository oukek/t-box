# 错误与数据库访问规范

## 错误工厂

业务代码使用类型化工厂，不直接构造 `Error` / `ApiError`，也不重复填写错误码、HTTP 状态和默认提示：

```ts
throw ErrorCode.MODEL_NOT_FOUND()
throw ErrorCode.MODEL_NOT_FOUND(`模型配置 ${displayName} 已被移除`)
throw ErrorCode.VALIDATION_ERROR(undefined, { nickname: '昵称不能为空' })
```

`packages/errors` 是无框架、无 Node 专属依赖的通用错误包，导出 `ApiError`、`CodedError` 及工厂定义方法。`ApiError` 仍可用于 `instanceof` 判断；`@t-box/server-foundation/errors` 保留兼容导出，原有 HTTP 错误结构不变。

每个 API 错误码只声明一次。跨领域共用错误在 `packages/errors/src/common.ts`；平台专属错误在 `api/src/error-codes.ts`；应用错误在各应用自己的 `server/src/error-codes.ts`。SDK 桥接错误由 `@t-box/app-sdk` 的 `SdkErrorCode` 提供。计算器、日期时间等纯领域错误通过专属工厂保留原错误类型，供 HTTP / 应用边界统一转换。应用不依赖平台私有错误目录。

默认提示由目录定义，动态提示和字段校验详情可在调用时传入。少数历史错误码原本对应多个 HTTP 状态，为保持接口兼容，在同一条定义中显式列出变体，例如 `ErrorCode.APP_NOT_INSTALLED.conflict()`；业务侧不再填写状态数字。不要把无关错误归到一个泛用业务码。

内部配置、存储和运行错误使用带模块命名空间的内部工厂，保留 `cause`，不会因此成为可直接向客户端展示的 `ApiError`。外部服务自由文本、SQL、密钥和请求内容仍经过既有错误脱敏边界。HTTP / SDK 的 `fromResponse`、`from` 是传输适配，可以保留远端错误码，但不能把它注册成平台自己的错误定义。

原生 JavaScript 错误只出现在错误工厂、传输适配、测试故障注入，以及构建 / 部署工具的技术校验中。部署工具不使用业务 API 错误协议，无须加载整个后端错误目录。

## TypeORM 使用边界

- 简单实体读取、存在性检查和增删改优先使用 Repository。
- 普通筛选、分页、批量 ID 和条件更新也使用 Repository：`findOne` / `find` / `count` / `existsBy` / `insert` / `update` / `delete`，结合 `In`、`IsNull`、`LessThan` 等操作符。不要为换掉 SQL 而机械生成 QueryBuilder 链。
- 联表、聚合、计算投影、数据库表达式参与的原子更新和 upsert 可以使用 QueryBuilder；用户值必须通过命名参数或 ORM 值对象绑定。QueryBuilder 本身不是问题，选用取决于查询语义。
- 日期时间函数保留数据库 UTC 语义。财务金额继续使用精确十进制字符串 / bigint，不转成浮点数。
- 全部业务表都有显式、带类型的实体元数据，应用实体仍由各应用拥有，初始化 DDL 保持独立。JSON 列传对象/数组，由 ORM 编码一次；`mediumtext` 格式的历史快照仍传 JSON 文本。未知输入通过 `jsonDocument` 校验序列化，避免循环引用、BigInt 等非 JSON 值。
- 从原始行复制布尔字段到实体写入对象时，先将 MySQL 的 `0` / `1` 转为真正的 boolean；部分更新也要转换保留的旧值，避免启用状态被 ORM 改成关闭。
- 只选择可空字段时，要同时选择主键等非空标识，避免 ORM 将存在但投影全为 NULL 的行当作不存在。
- 查询均显式选择实际使用的字段，禁止 `*` / `alias.*`，列表和公开视图不取凭证、检查点或租约等内部字段。密码、密钥和恢复凭证在实体中默认 `select: false`，仅鉴权等内部流程明确选取。
- 原有复杂联表返回行结构使用 `getRawMany` / `getRawOne` 保留；单独选择带表前缀的字段必须指定结果别名，例如 `.select('u.id', 'id')`。实体读取则使用 `find*` / `getOne` 按实体属性返回。
- 行锁使用当前事务的 EntityManager 和 Repository `lock: { mode: 'pessimistic_write' }`（复杂查询可 `.setLock(...)`）；MySQL 命名锁始终使用持有该锁的 QueryRunner 连接。更新结果使用 TypeORM 的 `affected`。

复杂财务累计投影、聚合报表、关联子查询的原子状态更新、条件权限合并、`INSERT SELECT` 和多表授权清理保留经过审查的原生 SQL。每处都有 `native-sql:` 注释说明原因。首次初始化的固定 DDL / 种子独立于运行时实体，避免以后实体调整悄悄修改已发布基线。

## 自动检查

`pnpm check:business` 扫描全部运行时源码，检查散落的错误构造、重复 API / 内部错误码、非法 HTTP 状态、没有解释的原生 SQL，通配符查询，以及容易改变返回字段名的 QueryBuilder 选择。普通 CRUD 即使加 `native-sql:` 注释也不能绕过检查。

检查保留在本地 `pnpm check` 中，按需运行；GitHub Actions“代码规范检查”仅运行 `pnpm lint`。新增错误或数据访问逻辑可单独运行类型检查及对应业务回归。

## 事务与外部 I/O

同一业务的不变量、权限复查、幂等记录、业务写入、资金变动和审计必须使用同一个事务 EntityManager。条件更新仍需检查 `affected`，旧 worker 的租约凭证不能修改新 worker 的状态；不能只把多条 SQL 包进事务而忽略并发锁顺序和幂等键。

模型、微信、OAuth 网络请求和对象存储上传不能放在数据库锁中。文件先写入资源系统，再在账本事务里复查权限并建立关联；失败的财务提交不产生部分账目，已上传的个人文件保留在「我的资源」供复用。已确认的幂等重复上传会清理多余副本；无法判断是否提交成功时保留文件，避免误删已关联附件。分类图标失败时先核对数据库是否已提交，再决定清理对象。

数据库拒绝 `where` 中的 `null` 和 `undefined`，需要匹配 SQL NULL 时显式使用 `IsNull()`，避免省略条件后误读、误改其他记录。`deleteAll()` 用于明确的批量清理，不使用会隐式提交的 `TRUNCATE` / `clear()`。

新持久化实体将 DATETIME 转成 UTC SQL 时钟字符串，兼容既有实体的 Date 结果时用 `sqlClock`；将 UTC SQL 字符串写入既有日期实体时用 `utcDate`。连接使用 `timezone: Z`，仅将 `DATE` 返回为字符串，DATETIME 返回 UTC Date；不要把 UTC 日期先按本地时区解析（夏令时切换会丢失或移动时间）。也不要在 `Raw` 操作符前省略空格，否则属性名替换可能失效。集成测试在 UTC、上海和纽约时区验证读写，并核对全部表的实体覆盖、JSON/BIGINT 精度、事务回滚、过期租约和并发限额。

## TypeScript 边界

业务源码禁止显式 `any`，由 ESLint `ts/no-explicit-any` 检查；测试中的故障注入桩单独处理。普通实体结果使用 Repository 推断，复杂 SQL 在查询边界声明真实投影类型，不给回调参数加 `any`。日期、可空字段和 MySQL 聚合数值的类型必须反映实际返回值。

JSON 解析返回 `unknown`，网络回执、持久化工具回执和管理端检查点读取需要校验后再访问字段；不要用双重断言伪装已校验。管理端仅提取允许展示的消息字段，原检查点仍不能序列化给前端。客户端与后台历史回执分别保留各自长度限制，避免类型整理截断已有后台错误。

各应用的前后端共用应用自己的 `contracts`。例如账本视图、附件、报销、账户和批量记录类型由 `apps/ledger/contracts` 提供；批量记录使用 `kind` 与 `input` 关联的联合类型。前端请求默认返回 `unknown`，调用方必须声明具体响应类型，避免未指定泛型时传播 `any`。

新增工作区依赖后，先运行 `pnpm install`、`pnpm build:contracts`，再重启长时间运行的 Vite 开发服务，刷新其包解析缓存。无需为此添加路径别名或修改正确的 ESM 导出。`workspace-imports.test.ts` 会验证浏览器实际使用的错误模块能通过 Vite 转换。
