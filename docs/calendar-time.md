# 日历与时间应用

两个独立应用：`calendar` 日历、`time` 时间。从应用页打开；已接入 AI 时可以 `@日历`、`@时间`。AI 未配置时不执行本地意图识别。日期、当前时间由服务器获取，不能依赖模型训练知识。直接使用页面不收费；AI 调用时会话模型 token 仍按平台计费。

## 功能与边界

日历：42 格月历、周日程、事件搜索、类型筛选、农历日期展示、纪念日／生日倒数及周年数。事件支持标题、备注、地点、颜色、全天或指定时间、多天事件、IANA 时区、最多三次提前提醒。按天、周、月、年重复，可设间隔、每周多天、截止日期；31 日和闰年生日可选择跳过或当月最后一天。完成／跳过仅影响指定 occurrenceDate，可从事件详情恢复。编辑标题、备注、地点、颜色或提醒保留单次状态；修改时间、时区、全天类型或重复规则会清除单次状态。删除整个事件需确认。

日历事件可选择公历或农历日期，包括生日、纪念日和普通日程。农历事件保存原始年月日及闰月规则，每次重复和提醒均重新换算公历。放假调休从数据库已发布的年度安排读取，详见 [年度节假日](calendar-holidays.md)。没有 CalDAV、系统日历或 Google/Apple 日历同步。事件当前属于个人账号，不关联共享账本。每账号最多 1000 个事件、查询最多 371 天、最多返回 5000 个发生实例。事件最长 31 天。JSON 备份 v2 保存农历设置且仍可导入 v1 公历备份，仅导出事件定义，不包含单次完成／跳过记录；最多 5 MB / 1000 条。导入为新增，不覆盖；界面保留当前批次成功进度，失败可重试未完成部分。重新选择并导入同一备份会创建新事件。

时间：服务器时间校准、世界时钟（常用城市和自定义 IANA 时区，最多 12 个）、今日日期、星期、ISO 周数、年内天数、UTC 偏移。多个倒计时（1 秒至 7 天，最多 50 个保留记录），暂停、继续、重新开始、取消和删除。带累计／本段时间的秒表，最多 200 个分段。时区转换、日期转 Unix 时间戳、秒／毫秒时间戳转日期、实际时间差、按秒至年的日期时间加减。倒计时入库，世界时钟和秒表按账号保存在当前设备；秒表关闭后按设备时间继续，调系统时钟会影响结果。

## 日期时间口径

前后端统一使用 `@t-box/dayjs`（Day.js、UTC、timezone、customParseFormat、isoWeek、dayOfYear、isLeapYear、zh-cn），无 Temporal 依赖；日期范围 1900-01-01 至 9999-12-31。全天 end 排他，例如 10 月 6 日的全天事件 start=2026-10-06、end=2026-10-07；页面结束日期输入为包含当天。全天日期在不同时区保持相同日历日期，提醒在事件时区上午 9 点开始计算。定时事件输入为本地时间与明确 IANA 时区，转换后以 UTC 计算。重复定时事件保持当地钟表时间，而非每隔固定 24 小时。夏令时不存在或重复的开始／结束时间会拒绝创建；重复展开遇到这种时间会跳过该次。详情和 AI 工具使用 occurrenceDate（事件时区），而不是用户查看时区的显示日期。

时间差为真实经过时长，夏令时的一天可为 23／25 小时。日期加减中小时为实际经过时间；日／周为日历单位，月／年超出目标日期按当月末约束。日期偏移落在春季跳时段时向后调整相应时差，重复钟表时间取较早的瞬间；创建和重复展开仍拒绝不明确时间。日历单位在 UTC 中计算钟表字段，再重新解析目标时区，避免 Day.js add 保留旧时区偏移。时间工具返回原始值、时区、偏移及时间戳，不静默丢弃超范围输入。

## 提醒

网页仅页面打开时显示提醒；关闭网页不发通知，没有 Service Worker 或推送服务。原生 App 使用官方 `@capacitor/local-notifications`，用户点击「启用系统通知」后申请权限，不从 AI 工具中自动请求权限。最多安排最近 48 条未来日历／倒计时提醒，打开应用后补充；不保证应用永不打开时无限重复通知。

系统通知属于当前设备。改动后只取消已删除／已改变的通知；相同提醒使用稳定 ID，避免定时刷新取消即将触发的提醒。写入后强制等待旧的读取完成，再获取新状态，避免复用写入前的提醒快照。数据库写入成功不等于通知同步成功：工具结果分别返回 event/timer 与 deviceReminder；无客户端、超时或权限未授权均不会回滚已写入数据，也不得宣称后台提醒已开启。同一账号冷启动保留已安排通知，退出或切换账号取消旧账号通知；本机提醒阅读历史按账号保存，避免刷新后重复提示。

Android 13 通知权限、Android 12+ 精确闹钟授权及省电策略会影响提醒；使用 SCHEDULE_EXACT_ALARM，按钮打开系统授权页，不使用无需用户授权的 USE_EXACT_ALARM。iOS / Android 系统仍可限制投递，须实机测试授权、锁屏、杀进程、重启、时区变化、取消、账号切换。参考 [Capacitor 官方通知文档](https://capacitorjs.com/docs/apis/local-notifications)。未接入远程推送或常驻后台计时服务，不保证秒表、倒计时网页在后台每秒刷新。

## 模块结构与持久化

- `apps/calendar/contracts/src/`：事件类型、严格参数校验、重复展开、提醒计算。`apps/time/contracts/src/`：时间快照、时区与时间戳计算、倒计时状态转换；无网络、数据库或 AI 依赖。
- `apps/calendar/server/src/`、`apps/time/server/src/`：各自 EntitySchema、service、REST routes、SDK 工具、skill、专业 Agent、资源权限适配和导航声明。所有私有资源再次按当前用户验证，模型提供的 ID 不是授权。
- `packages/server-foundation/src/persistence/`：通用事务及幂等操作记录。REST 写操作要求 Idempotency-Key；按用户／应用／操作标识隔离、相同参数重放原结果，不同参数返回 409。用户行锁保证并发去重与数量约束。修改和删除要求最新 revision，防止覆盖其他设备的改动。AI 工具使用 requestId 与规范化参数生成稳定标识。
- `apps/calendar/web/src/`：日历页面、事件编辑弹窗、备份组件、确认宿主。`time/`：时钟／倒计时页面、独立秒表和时间换算组件。自己实现 UI，日期、时间和选项通过 Sheet 输入。
- `app/src/features/reminders/`：公共设备提醒协调器、稳定 ID 差量计划、权限设置和全局提醒宿主。原生同步异步串行，账号版本保护过期响应。
- `app/src/core/applicationMutation.ts`：未知网络结果保留操作标识，完全相同请求重试不会重复新增；确定的失败清理标识。结果不明时应先重试原请求或刷新查看，改变输入代表一次新操作。

日历与时间应用各自的 `server/src/schema.ts` 提供 calendar_events、calendar_exceptions、app_timers、application_operations 的首次建表定义，由平台初始化入口统一执行。数据库外键按账号级联清理。事件／倒计时删除为软删除；尚未实现历史操作记录的自动归档，长期大规模运行前应增加保留策略。

AI 运行层无日历或时间业务分支；只在前后端 application registry 注册模块。能力入口自动显示工具／交互／技能／Agent。time_now 为基础只读工具，未激活 skill 也可查询；其余能力由对应 skill 激活。专业 Agent 不绕过权限。calendar_event_delete 通过 calendar_confirm 返回严格 approved=true 才执行；同步提醒通过独立的可选 ui 交互，不接收凭据或生成代码。前端关闭时服务端仍可创建日程和倒计时，设备提醒同步延后到下次打开；删除确认必须等待前端，不能跳过。

## REST 与 AI 工具

REST 前缀 `/api/v1`，均需登录，响应 no-store。

| 日历               | 方法 / 路径                                                                    |
| ------------------ | ------------------------------------------------------------------------------ |
| 搜索事件           | GET /calendar/events?search=...                                                |
| 事件详情／单次状态 | GET /calendar/events/:id、GET /calendar/events/:id/occurrence-states           |
| 展开日程           | GET /calendar/occurrences?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=Asia/Shanghai |
| 当前设备提醒源     | GET /calendar/reminders?timezone=Asia/Shanghai （含最近 10 分钟避免刷新漏报）  |
| 创建／修改／删除   | POST /calendar/events、PATCH /calendar/events/:id、DELETE /calendar/events/:id |
| 完成／跳过／恢复   | POST /calendar/events/:id/occurrence-state                                     |

工具：calendar_today、calendar_date_info、calendar_events_list、calendar_occurrences、calendar_event_get、calendar_event_create、calendar_event_update、calendar_event_delete、calendar_occurrence_state。技能 calendar_planning、专业 Agent calendar。

时间 REST：GET /time/now?timezone=...、POST /time/calculations、GET/POST /time/timers、POST /time/timers/:id/actions、DELETE /time/timers/:id。工具 time_now、time_calculate、time_timers_list、time_timer_create、time_timer_control、time_timer_delete。技能 timekeeping、专业 Agent time。

## 开发与验证

先 `pnpm db:init`，再 `pnpm dev`。网页 `/#/applications/calendar`、`/#/applications/time`。`pnpm native:sync` 更新原生通知依赖及打包资源，原生热更新仍用既有 native:dev:ios / native:dev:android。

`pnpm typecheck`、`pnpm test`、`pnpm test:calendar-time`、`pnpm build`。集成测试使用临时账号并清理，覆盖 MySQL 真实持久化、账号隔离、并发幂等、版本冲突、单次状态保留／重置、REST、工具写入和客户端通知失败后数据保留。单元测试覆盖夏令时、月底、闰年、时区、重复间隔、午夜跨日、倒计时状态机、通知差量与秒表恢复。

## 农历、节气与节假日

`lunar-events.ts` 在同一个农历库上封装事件日期与重复语义，独立于 AI 核心。农历锚点 `lunar` 包含 `year/month/day/leapMonth/leapPolicy`，存入现有事件 JSON；旧事件缺少该字段时按公历处理，不需要改表或转换旧日期。`start/end` 仍是供通用事件时区和跨度处理的公历日期，后端校验 `start` 与农历锚点一致。日期选择器用真实年度的月份和天数，只允许实际存在的闰月、初一至廿九／三十。农历年份与换算后的公历日期均限 1900–2100。

- 每年：按农历年间隔及月日计算。普通月事件不会在同名闰月再发生一次。闰月锚点的 `leapPolicy=regular` 表示不存在对应闰月时使用同名普通月，`skip` 表示跳过该年；存在对应闰月时只在闰月发生。
- 每月：按真实农历月份计数，闰月也计一个月。三十在小月不存在时，使用 `monthPolicy=skip/last_day` 跳过或使用廿九。
- 单次：只在锚点公历日期发生。每天、每周仍按自然日及 ISO 周计算。
- 截止日期、结束日期和单次状态键均使用公历。修改农历日期或闰月规则会重置单次状态；标题修改保留。周年数使用发生日农历年减锚点农历年，避免跨公历新年的误差。

AI 创建／更新事件的工具包含可空 `lunar` 配置，提供后端工具 `calendar_lunar_to_solar` 以验证并换算农历输入。技能要求先确认公历／农历与原始年份，不能只换算一次后创建公历每年重复。网页、AI、服务端提醒和单次状态校验共用同一套 `occursOn/expandCalendar`。

`apps/calendar/contracts/src/almanac.ts` 使用 lunar-typescript 提供前后端共用的纯日期查询：农历年月日、闰月、干支年（以农历年为界）、生肖、24 节气、下个节气日期、公历及传统节日。当前农历展示范围 1900–2100 年；其他年份继续支持普通日历和事件，不伪造农历信息。日期按公历年月日计算，与设备时区无关。节气按中国历法的日期展示，不是设备所在地的天文时刻。月格优先显示节日、节气，再显示农历日（月初显示月名）；完整信息在选中日期下展示。

年度放假调休由日历应用后端同步并保存到数据库，前端通过 API 和 SDK 缓存读取，AI 工具读取同一份已发布安排。节日名称与休／班安排分开，未知年度不会据节日名称推断放假。首次初始化仅内置之前核实的 2026 年数据；其他年度自动同步或后台审核发布。详见 [节假日数据与后台管理](calendar-holidays.md)。

`GET /api/v1/calendar/date-info?date=YYYY-MM-DD` 需登录，返回 `CalendarDayInfo`。后端工具 `calendar_date_info` 查询指定日期，`calendar_today` 增加 `almanac` 字段，均在后端执行，无需前端在线。日历技能明确要求区分节日与官方放假，未向 AI 核心添加应用业务逻辑。
