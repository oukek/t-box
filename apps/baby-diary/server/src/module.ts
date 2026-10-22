import type {
  Actor,
  ApplicationModule,
  ApplicationToolContext,
} from '@t-box/app-server-sdk'
import type {
  BabyProfile,
  BabyScope,
  BabyVisibility,
} from '@t-box/baby-diary-contracts'
import type { CarePage } from '@t-box/baby-diary-contracts/care'
import { definition } from '@t-box/app-server-sdk'
import {
  babyDiaryManifest,
  BabyErrorCode,
  id,
  integer,
  parseBabyParams,
} from '@t-box/baby-diary-contracts'
import { fingerprint } from '@t-box/server-foundation/persistence/operations'
import { careToolRecord } from './care-tools.js'

export interface BabyToolPort {
  invoke(
    context: ApplicationToolContext,
    method: string,
    args: unknown,
  ): Promise<unknown>
  inspect(
    actor: Actor,
    babyId: string,
    action: string,
    type?: string,
  ): Promise<void>
}
function toolArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw BabyErrorCode.BABY_INVALID_INPUT()
  }
  return value as Record<string, unknown>
}
const str = (description: string, maxLength = 200) => ({
  type: 'string',
  description,
  maxLength,
})
const nullable = (type: Record<string, unknown>) => ({
  anyOf: [type, { type: 'null' }],
})
const record = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['diary', 'measurement', 'milestone'] },
    date: str('真实发生日期 YYYY-MM-DD', 10),
    title: str('日记或里程碑标题；测量记录可为空', 100),
    text: str('正文或备注', 10000),
    tags: { type: 'array', items: str('标签', 20), maxItems: 10 },
    assetIds: {
      type: 'array',
      items: str('已获授权的附件 ID', 36),
      maxItems: 20,
    },
    visibility: { type: 'string', enum: ['members', 'managers'] },
    measurement: nullable({
      type: 'object',
      properties: {
        heightMm: nullable({ type: 'integer', minimum: 100, maximum: 2500 }),
        weightGrams: nullable({
          type: 'integer',
          minimum: 100,
          maximum: 200000,
        }),
        headMm: nullable({ type: 'integer', minimum: 100, maximum: 1000 }),
        method: { type: 'string', enum: ['lying', 'standing', 'unspecified'] },
      },
      required: ['heightMm', 'weightGrams', 'headMm', 'method'],
      additionalProperties: false,
    }),
  },
  required: [
    'kind',
    'date',
    'title',
    'text',
    'tags',
    'assetIds',
    'visibility',
    'measurement',
  ],
  additionalProperties: false,
}
export function createBabyDiaryModule(port?: BabyToolPort): ApplicationModule {
  const invoke = (
    ctx: ApplicationToolContext,
    method: string,
    args: unknown,
  ) => {
    if (!port || !ctx.actor) {
      throw BabyErrorCode.BABY_FORBIDDEN()
    }
    ctx.signal.throwIfAborted()
    return port.invoke(ctx, method, args)
  }
  const scopedResources = (
    scopes: { scope: BabyScope, visibility: BabyVisibility }[],
    babyId: string,
  ) =>
    [
      ...new Set(
        scopes.map((row) =>
          row.visibility === 'managers' ? `private-${row.scope}` : row.scope,
        ),
      ),
    ].map((type) => ({
      resource: { appId: 'baby-diary', resourceType: type, resourceId: babyId },
      action: 'read',
    }))
  const resources = async (value: unknown, ctx: ApplicationToolContext) => {
    const args = toolArgs(value)
    const babyId = id(args?.babyId)
    const profile = (await invoke(ctx, 'babies_get', {
      babyId,
    })) as BabyProfile
    const scopes = args.kind
      ? [args.kind === 'measurement' ? ('growth' as const) : ('diary' as const)]
      : profile.scopes.filter((scope) => scope === 'diary' || scope === 'growth')
    return scopedResources(
      scopes.flatMap((scope) => [
        { scope, visibility: 'members' as const },
        ...(['owner', 'admin'].includes(profile.role)
          ? [{ scope, visibility: 'managers' as const }]
          : []),
      ]),
      babyId,
    )
  }
  return {
    id: 'baby-diary',
    contractVersion: '1.0',
    manifest: babyDiaryManifest,
    interactions: [],
    access: {
      appId: 'baby-diary',
      async inspect(actor, resource, action) {
        if (!port) {
          throw BabyErrorCode.BABY_FORBIDDEN()
        }
        await port.inspect(
          actor,
          resource.resourceId,
          action,
          resource.resourceType,
        )
        return {}
      },
    },
    tools: {
      baby_care_query: {
        title: '查询宝宝照护与统计',
        execution: 'server',
        effect: 'read',
        successSummary: '已查询照护记录和统计',
        definition: definition('baby_care_query', '查询授权宝宝的喂养、睡眠、尿布、进行中计时和逐日统计，最多 31 天。奶量为已记录瓶喂量，亲喂只统计时长；未记录不代表未发生。明细截断时缩小日期范围，逐日统计仍完整。', { babyId: str('宝宝 ID', 36), from: str('宝宝当地开始日期 YYYY-MM-DD', 10), to: str('宝宝当地结束日期 YYYY-MM-DD', 10), limit: { type: 'integer', minimum: 1, maximum: 100, description: '明细数量上限，统计不受此限制' } }),
        resources: (value) => scopedResources([{ scope: 'care', visibility: 'members' }], id(toolArgs(value).babyId)),
        handler: async (value, ctx) => {
          const args = toolArgs(value)
          const limit = integer(args.limit ?? 50, '明细数量', 1, 100)
          const page = await invoke(ctx, 'care_list', { babyId: args.babyId, from: args.from, to: args.to }) as CarePage
          return { ...page, records: page.records.slice(0, limit), recordCount: page.records.length, truncated: page.records.length > limit, latest: Object.fromEntries((['feeding', 'sleep', 'diaper'] as const).map((kind) => [kind, page.records.find((row) => row.kind === kind) ?? null])) }
        },
      },
      baby_care_add: {
        title: '批量记录宝宝照护',
        execution: 'server',
        effect: 'write',
        successSummary: '照护记录已保存',
        writeFingerprint: fingerprint,
        definition: definition('baby_care_add', '为同一宝宝原子添加 1 至 30 条喂养、睡眠或尿布记录，也可开始亲喂或睡眠计时。先明确宝宝、时间和单位；不推测奶量、不计算医疗剂量、不创建重复计时。', { babyId: str('宝宝 ID', 36), records: { type: 'array', minItems: 1, maxItems: 30, items: careToolRecord } }),
        resources: (value) => scopedResources([{ scope: 'care', visibility: 'members' }], id(toolArgs(value).babyId)),
        handler: (args, ctx) => invoke(ctx, 'care_add', args),
      },
      baby_care_update: {
        title: '更新宝宝照护计时或记录',
        execution: 'server',
        effect: 'write',
        successSummary: '照护记录已更新',
        writeFingerprint: fingerprint,
        definition: definition('baby_care_update', '先查询得到准确 ID 和 revision，再暂停、换边、结束计时或按用户要求修改记录。结束亲喂须关闭未结束分段。版本冲突时重新查询核对，不盲目覆盖。', { babyId: str('宝宝 ID', 36), id: str('照护记录 ID', 36), revision: { type: 'integer', minimum: 1 }, record: careToolRecord }),
        resources: (value) => scopedResources([{ scope: 'care', visibility: 'members' }], id(toolArgs(value).babyId)),
        handler: (args, ctx) => invoke(ctx, 'care_update', args),
      },
      baby_diary_list: {
        title: '查询宝宝档案',
        execution: 'server',
        effect: 'read',
        successSummary: '已查询可访问的宝宝档案',
        resources: async (_value, ctx) =>
          ((await invoke(ctx, 'babies_list', {})) as BabyProfile[]).map(
            (profile) => ({
              resource: {
                appId: 'baby-diary',
                resourceType: 'baby',
                resourceId: profile.id,
              },
              action: 'read',
            }),
          ),
        definition: definition(
          'baby_diary_list',
          '列出当前账号有权限访问的宝宝档案。目标宝宝不明确或同名时必须询问，不推断 babyId。',
          {},
        ),
        handler: (_, ctx) => invoke(ctx, 'babies_list', {}),
      },
      baby_diary_records: {
        title: '查询宝宝记录',
        execution: 'server',
        effect: 'read',
        successSummary: '已查询宝宝记录',
        definition: definition(
          'baby_diary_records',
          '查询已授权宝宝的日记、测量和里程碑，按需限制日期和数量。尊重内容范围，不读取其他宝宝。',
          {
            babyId: str('宝宝 ID', 36),
            kind: nullable({
              type: 'string',
              enum: ['diary', 'measurement', 'milestone'],
            }),
            from: nullable(str('起始日期 YYYY-MM-DD', 10)),
            to: nullable(str('结束日期 YYYY-MM-DD', 10)),
            query: nullable(str('搜索关键词', 80)),
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        ),
        resources,
        handler: (args, ctx) => invoke(ctx, 'records_list', args),
      },
      baby_diary_add: {
        title: '批量添加宝宝记录',
        execution: 'server',
        effect: 'write',
        successSummary: '宝宝记录已保存',
        writeFingerprint: fingerprint,
        definition: definition(
          'baby_diary_add',
          '一次为同一个宝宝添加 1 至 30 条日记、成长测量或里程碑，原子提交。身高/头围用毫米，体重用克；日期、单位、宝宝不明确时询问，不能编造测量、附件或诊断。',
          {
            babyId: str('宝宝 ID', 36),
            records: {
              type: 'array',
              minItems: 1,
              maxItems: 30,
              items: record,
            },
          },
        ),
        resources: (value) => {
          const args = toolArgs(value)
          if (!Array.isArray(args.records)) {
            throw BabyErrorCode.BABY_INVALID_INPUT()
          }
          return scopedResources(
            args.records.map((input) => {
              const row = toolArgs(input)
              return {
                scope: row.kind === 'measurement' ? 'growth' : 'diary',
                visibility:
                  row.visibility === 'managers' ? 'managers' : 'members',
              }
            }),
            id(args.babyId),
          )
        },
        handler: (args, ctx) => invoke(ctx, 'records_add', args),
      },
      baby_diary_growth: {
        title: '查询成长测量',
        execution: 'server',
        effect: 'read',
        successSummary: '已查询宝宝成长测量',
        definition: definition(
          'baby_diary_growth',
          '读取宝宝真实的身长/身高、体重和头围记录。只描述已有趋势，不补造缺失测量或给出健康诊断。',
          {
            babyId: str('宝宝 ID', 36),
            from: nullable(str('起始日期 YYYY-MM-DD', 10)),
            to: nullable(str('结束日期 YYYY-MM-DD', 10)),
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        ),
        resources: async (value, ctx) => {
          const babyId = id(toolArgs(value)?.babyId)
          const profile = (await invoke(ctx, 'babies_get', {
            babyId,
          })) as BabyProfile
          return scopedResources(
            [
              { scope: 'growth', visibility: 'members' },
              ...(['owner', 'admin'].includes(profile.role)
                ? [
                    {
                      scope: 'growth' as const,
                      visibility: 'managers' as const,
                    },
                  ]
                : []),
            ],
            babyId,
          )
        },
        handler: (args, ctx) => invoke(ctx, 'growth_get', args),
      },
      baby_diary_projects: {
        title: '查询创意成长项目',
        execution: 'server',
        effect: 'read',
        successSummary: '已查询创意项目',
        definition: definition(
          'baby_diary_projects',
          '查询已授权宝宝的创意照片项目。图片保持私有，不能请求或编造永久图片链接。',
          { babyId: str('宝宝 ID', 36) },
        ),
        resources: async (value, ctx) => {
          const babyId = id(toolArgs(value)?.babyId)
          const profile = (await invoke(ctx, 'babies_get', {
            babyId,
          })) as BabyProfile
          return scopedResources(
            [
              { scope: 'creative', visibility: 'members' },
              ...(['owner', 'admin'].includes(profile.role)
                ? [
                    {
                      scope: 'creative' as const,
                      visibility: 'managers' as const,
                    },
                  ]
                : []),
            ],
            babyId,
          )
        },
        handler: (args, ctx) => invoke(ctx, 'projects_list', args),
      },
    },
    skills: {
      'baby-care': {
        title: '宝宝日常照护',
        description: '喂奶、亲喂计时、睡眠、换尿布及照护统计',
        version: '1.0.0',
        tools: ['baby_diary_list', 'baby_care_query', 'baby_care_add', 'baby_care_update'],
        instructions: '先明确目标宝宝。使用宝宝时区确定真实时间，缺少时间、宝宝或单位时询问。亲喂左右换边作为同一次喂养的有序分段，瓶喂按实际摄入毫升记录，未知量填 null；吸奶不是摄入量。睡眠跨日按实际时段分摊。记录和统计由应用计算，不补造缺失事实，不诊断、不提供自动用药或固定喂养目标。已有计时冲突先查询核对；写入结果不确定时不能另建重复记录。',
      },
      'baby-journal': {
        title: '宝宝成长记录',
        description: '多个宝宝的日记、身高体重、里程碑与私有创意影像',
        version: '1.0.0',
        tools: [
          'baby_diary_list',
          'baby_diary_records',
          'baby_diary_add',
          'baby_diary_growth',
          'baby_diary_projects',
        ],
        instructions:
          '先通过档案列表明确宝宝；只使用用户授权的资源。记录真实发生的日期、数值与单位，不推断健康状况，不发送照片到外部模型、不创建公开分享。用户批量描述可一次提交不同记录类型。缺少宝宝或单位时询问。不能把口头的身高厘米当毫米，千克需准确换为克。创意播放在应用内完成，无需 AI 生图。成员、邀请、档案转让等敏感管理操作在应用界面由用户执行，不开放给模型。',
      },
    },
    agents: [
      {
        id: 'baby-journal',
        title: '宝宝照护与成长助手',
        description: '记录日常照护、回顾真实成长与里程碑',
        version: '1.0.0',
        skillIds: ['baby-journal', 'baby-care'],
        instructions:
          '专注保存和回顾真实记录，尊重宝宝、成员和可见范围；不提供疾病诊断或自动用药建议。',
      },
    ],
    navigation: {
      properties: {
        babyId: nullable(str('宝宝 ID', 36)),
        tab: nullable({
          type: 'string',
          enum: ['care', 'statistics', 'records', 'growth', 'creative'],
        }),
      },
      parse: parseBabyParams,
    },
  }
}
