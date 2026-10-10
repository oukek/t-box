import type {
  ApplicationModule,
  ApplicationToolContext,
  ApplicationToolRegistration,
  ResourceAdapter,
} from '@t-box/app-server-sdk'
import type { TimeService } from './service.js'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/app-contracts'
import { definition, nullable } from '@t-box/app-server-sdk'
import { calendarObject } from '@t-box/calendar-contracts'
import { ApiError } from '@t-box/server-foundation/errors'
import { temporalDomain } from '@t-box/server-foundation/persistence/errors'
import { fingerprint } from '@t-box/server-foundation/persistence/operations'
import {
  calculateTime,
  parseTimeParams,
  timeClientInteractions,
  timeManifest,
  timeSnapshot,
} from '@t-box/time-contracts'

export function timeAccessAdapter(service: TimeService): ResourceAdapter {
  return {
    appId: 'time',
    async inspect(actor, ref, action) {
      if (ref.resourceType !== 'timer' || !['read', 'write'].includes(action)) {
        throw new ApiError(400, 'INVALID_SCOPE', '不支持的时间资源')
      }
      await service.get(actor.user.id, ref.resourceId)
      return {}
    },
  }
}
export function createTimeModule(service?: TimeService): ApplicationModule {
  const user = (ctx: ApplicationToolContext) => {
    if (!service || !ctx.actor) {
      throw new ApiError(503, 'TIME_UNAVAILABLE', '请登录后使用时间应用')
    }
    ctx.signal.throwIfAborted()
    return ctx.actor.user.id
  }
  const sync = async (ctx: ApplicationToolContext) => {
    try {
      const result = await ctx.interact({
        name: 'time_reminders_sync',
        arguments: {},
        timeoutMs: 5000,
        optional: true,
      })
      return result.ok ? result.data : { synced: false }
    } catch {
      return {
        synced: false,
        note: '倒计时已保存，当前设备提醒未同步。打开时间应用检查。',
      }
    }
  }
  const tools: Record<string, ApplicationToolRegistration> = {}
  const add = (
    name: string,
    title: string,
    properties: Record<string, Record<string, unknown>>,
    handler: ApplicationToolRegistration['handler'],
    write = false,
  ) => {
    tools[name] = {
      title,
      definition: definition(name, title, properties),
      execution: 'server',
      effect: write ? 'write' : 'read',
      successSummary: `已${title}`,
      handler,
      ...(write ? { writeFingerprint: fingerprint } : {}),
    }
  }
  add(
    'time_now',
    '获取服务器当前时间、今天日期及时间戳',
    {
      timezone: nullable({
        type: 'string',
        description: 'IANA 时区；null 默认 Asia/Shanghai',
        maxLength: 80,
      }),
    },
    async (value, ctx) => {
      ctx.signal.throwIfAborted()
      const a = temporalDomain(() => calendarObject(value, ['timezone']))
      return temporalDomain(() =>
        timeSnapshot(a.timezone == null ? undefined : String(a.timezone)),
      )
    },
  )
  tools.time_now!.alwaysAvailable = true
  add(
    'time_calculate',
    '时区转换、时间戳、时间间隔及日期时间偏移',
    {
      kind: {
        type: 'string',
        enum: ['convert', 'timestamp', 'difference', 'shift'],
      },
      source: { type: 'string', description: '输入的 IANA 时区' },
      target: nullable({
        type: 'string',
        description: '输出时区或结束时间的时区',
      }),
      value: { type: 'string', description: 'YYYY-MM-DDTHH:mm 或整数时间戳' },
      end: nullable({
        type: 'string',
        description: '差值终点 YYYY-MM-DDTHH:mm',
      }),
      amount: nullable({ type: 'string', description: '偏移整数' }),
      unit: nullable({
        type: 'string',
        enum: [
          'seconds',
          'milliseconds',
          'minutes',
          'hours',
          'days',
          'weeks',
          'months',
          'years',
        ],
      }),
    },
    async (value, ctx) => {
      ctx.signal.throwIfAborted()
      return temporalDomain(() => calculateTime(value))
    },
  )
  add('time_timers_list', '列出当前用户的倒计时', {}, async (_value, ctx) =>
    service!.list(user(ctx)))
  add(
    'time_timer_create',
    '创建并开始倒计时（1 秒至 7 天）',
    {
      label: { type: 'string', maxLength: 100 },
      durationSeconds: { type: 'integer', minimum: 1, maximum: 604800 },
    },
    async (value, ctx) => {
      const uid = user(ctx)
      const timer = await service!.create(
        uid,
        fingerprint([ctx.requestId, 'create', value]),
        value,
      )
      return { timer, deviceReminder: await sync(ctx) }
    },
    true,
  )
  add(
    'time_timer_control',
    '暂停、继续、重新开始或取消倒计时',
    {
      id: { type: 'string' },
      revision: { type: 'integer', minimum: 1 },
      action: {
        type: 'string',
        enum: ['pause', 'resume', 'restart', 'cancel'],
      },
    },
    async (value, ctx) => {
      const uid = user(ctx)
      const a = temporalDomain(() =>
        calendarObject(value, ['id', 'revision', 'action']),
      )
      const timer = await service!.control(
        uid,
        String(a.id),
        fingerprint([ctx.requestId, 'control', a]),
        { revision: a.revision, action: a.action },
      )
      return { timer, deviceReminder: await sync(ctx) }
    },
    true,
  )
  add(
    'time_timer_delete',
    '删除倒计时记录',
    { id: { type: 'string' }, revision: { type: 'integer', minimum: 1 } },
    async (value, ctx) => {
      const uid = user(ctx)
      const a = temporalDomain(() => calendarObject(value, ['id', 'revision']))
      const result = await service!.remove(
        uid,
        String(a.id),
        fingerprint([ctx.requestId, 'delete', a]),
        { revision: a.revision },
      )
      return { ...result, deviceReminder: await sync(ctx) }
    },
    true,
  )
  for (const name of ['time_timer_control', 'time_timer_delete']) {
    tools[name]!.resources = (value, ctx) => {
      user(ctx)
      const a = temporalDomain(() =>
        calendarObject(
          value,
          Object.keys(tools[name]!.definition.parameters.properties as object),
        ),
      )
      return [
        {
          resource: {
            appId: 'time',
            resourceType: 'timer',
            resourceId: String(a.id),
          },
          action: 'write',
        },
      ]
    }
  }
  return {
    id: 'time',
    contractVersion: APPLICATION_CONTRACT_VERSION,
    manifest: timeManifest,
    interactions: timeClientInteractions,
    tools,
    skills: {
      timekeeping: {
        title: '时间与倒计时',
        description: '查询真实当前时间、时区换算和管理倒计时。',
        version: '1.0.0',
        tools: Object.keys(tools),
        instructions:
          '获取现在或今天使用 time_now；不可依赖模型知识中的日期。默认 Asia/Shanghai，输出注明时区。区分秒和毫秒时间戳，区分日历天与 24 小时。倒计时操作先 time_timers_list 获取真实 ID 和 revision；不要创建重复计时器。创建后 app_open 打开 time 的 timers 标签。deviceReminder 未同步或未授权时，只可说倒计时数据已保存，不能保证关闭应用后提醒。秒表仅在本机使用，不会后台代替用户测量。',
      },
    },
    agents: [
      {
        id: 'time',
        title: '时间助手',
        description: '时区、实际时间查询与倒计时管理',
        version: '1.0.0',
        skillIds: ['timekeeping'],
        instructions:
          '用实际服务端时间作答，明确时区、夏令时与时间戳单位。依据用户明确意图管理倒计时，不承诺未授权的系统通知。',
      },
    ],
    ...(service ? { access: timeAccessAdapter(service) } : {}),
    navigation: {
      properties: {
        tab: nullable({
          type: 'string',
          enum: ['clock', 'timers', 'stopwatch', 'convert'],
        }),
        timezone: nullable({ type: 'string' }),
      },
      parse: (value) => temporalDomain(() => parseTimeParams(value)),
    },
  }
}
