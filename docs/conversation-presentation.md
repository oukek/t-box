# 会话标题与执行时间线

首次会话完成一轮回复后，后端使用该任务已选定的普通会话模型生成标题。标题请求不带业务工具、不带历史工具结果或密码，仅概括第一条用户文字；请求最多等待 8 秒，失败保留初始标题，后续完成回复时可再尝试。现有会话标题保留。

当前标题可点击修改，历史侧栏每条会话也有改名按钮，均使用自研弹窗。`PATCH /api/v1/conversations/:id {title}` 要求会话归属和当前资源授权，标题为 1–60 个字符。`title_source` 区分 pending/generated/manual；自动标题只更新 pending，手动改名优先，任务检查点或旧会话保存均不会覆盖它。标题是独立元数据，不改变防止任务并发覆盖的会话 revision。

## 同一条时序记录

`ChatMessage.timeline` 是面向前端的过程投影，`history` 仍是内部模型上下文，两者分开保存。每个节点包含稳定 id、sequence、revision、createdAt 及所属 Agent；按 sequence 排序，状态更新保留节点原位置。节点类型为思考摘要 reasoning、公开分析 analysis、工具 tool、最终回复 answer 和异常提示 notice。只有最后一个无工具调用的主助手回复成为最终回复；子 Agent 的公开摘要和工具进入同一条过程。

| WebSocket 事件 | 用途 |
| --- | --- |
| timeline.update | 创建节点，更新工具状态，或用完整公开文本校正节点 |
| timeline.delta | 按节点 id 和递增 revision 追加文字 |
| assistant.replace | 模型重试时校正兼容消息正文，避免截断回复与新响应拼接；时间线保留中断过程 |
| conversation.title | 自动生成标题后通知当前会话 |
| run.finished / session.snapshot | 完整快照校正，支持历史打开及重连恢复 |

前端忽略重复或旧 revision，增量缺口等待完整节点或快照校正。工具参数、私有确认载荷、密码、授权凭据、模型的加密推理内容都不进入公开时间线。权限过期的快照同时隐藏消息、时间线、附件和标题。

Socket 断开仅移除订阅，后端继续模型／工具循环；重连读取当前完整快照，过程仍按原 sequence 和 revision 排列。必须等待前端时，持久任务进入 `waiting_client`，工具保留等待状态，`run.finished.status=paused` 表示本次执行窗口暂停。重新打开后只恢复该待处理调用，不重新提交用户消息；错误暂停和 `needs_review` 不自动恢复。

`error {code: RESOURCE_LOCKED, resourceRefs}` 只在资源适配器验证成员资格后提供需要授权的资源标识；前端调用应用授权接口后重新连接，不通过模型或 Socket 发送密码。取消授权会停止自动重连，用户可手动重新连接继续。

完整模型轮次的时间线随执行检查点保存，派发副作用前先保存；未完成模型轮次的部分文字只能作为中断显示，恢复从最后完整检查点开始，不当作已完成推理回放。会话历史保存公开过程和 outcome；完成且已有最终回复时，前端默认折叠最终回复之前的全部过程。生成中、暂停或失败保持展开，结束后可手动展开/折叠。

活动回复的时间线末尾始终显示当前生成状态；即使工具已经结束、还在等待模型回复，也保留“生成中”提示。正在分析、调用工具、生成回复时按最后一个步骤更新提示，等待前端操作时显示“等待你处理”。提示是当前执行状态的界面投影，不写入历史步骤；任务结束后自动移除，输入框下方不再显示助手执行提示。外部工具结果不确定时保留具体的安全错误摘要，并继续禁止自动重复派发副作用。

图片应用通过工具注册的 `preview` 声明图片占位的类型、尺寸和文案。宿主在权限/参数校验通过且工具正式派发后，将该声明放入 `tool.update` 与同序号时间线节点；前端渲染自研动画占位卡片，不按工具名称猜测业务类型。失败、取消或暂停时停止动画；成功的 `tool.update.attachments` 立即更新已生成资源，在最终回复完成前就可显示图片。占位声明及状态随时间线持久化，重连不会额外发起生成。

`ChatMessage.execution` 保存 `startedAt`、累计 `durationMs`、执行窗口的 `activeSince` 和窗口结束的 `finishedAt`。开始事件立即携带计时数据，前端每秒本地刷新“已处理”；结束快照展示固定的“用时”，不足一分钟显示秒，否则显示分钟和秒。暂停时冻结，恢复后累计；断线但后端继续运行仍计时。累计值随任务检查点和会话档案保存，任务结束同时独立更新检查点中的计时，避免为了计时覆盖工具执行游标。崩溃后的未知离线区间不计入，仅从最近检查点累计值继续。旧消息没有执行时间字段时不推测历史耗时。token 与调用数据仍保留，不作为消息底部展示。

公开文字使用 requestAnimationFrame 平滑逐字显示，不重新播放历史；用户设置减少动态效果时直接显示。历史旧数据没有真实顺序，不虚构补排，使用原有兼容展示；新增消息使用统一时间线。

## 思考摘要与模型配置

后台模型编辑弹窗新增“请求思考摘要”，默认关闭。确认服务商支持后开启，Responses 请求增加 `reasoning.summary=auto`；适配 `response.reasoning_summary_text.delta/done`。未启用也能展示模型公开分析、实际工具调用及最终回复。服务商不返回摘要时不会捏造思考内容。

OpenAI 返回的是可公开的思考摘要，并不公开原始内部推理，见 [OpenAI Docs：Reasoning summaries](https://developers.openai.com/api/docs/guides/reasoning)。模型流使用 [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)，后端再转成项目自己的 WebSocket 协议，不让前端依赖供应商 SDK。

历史查询、改名和文件上传仍走 REST；会话生成、工具确认和进度走 WebSocket。无需增加第三方组件或额外 Socket.IO 依赖。

验证：`pnpm test` 覆盖流式顺序、摘要配置、公开内容隔离和中断状态；`pnpm test:ui-components` 覆盖重复/旧事件及增量缺口；`pnpm test:presentation` 使用临时身份与模拟模型，检查真实数据库标题生成/恢复、手动优先、所有权、输入校验及加密会话授权。不请求付费模型。
