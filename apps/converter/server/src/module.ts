import type { ApplicationBackend, ApplicationModule } from '@t-box/app-server-sdk'
import { ApplicationErrorCode, definition } from '@t-box/app-server-sdk'
import { conversionCategoryIds, converterManifest, parseConverterParams } from '@t-box/converter-contracts'
import { batchConvertUnits, conversionCatalog, convertUnits, discoverUnits } from '@t-box/converter-core'

const properties = {
  category: { type: 'string', enum: [...conversionCategoryIds] },
  value: { type: 'string', maxLength: 120, description: '十进制数或科学计数法；温差使用 temperature-interval，不使用 temperature。' },
  from: { type: 'string', maxLength: 120, description: '该类别内的准确单位 ID；先查询目录，不能猜测美制/英制或忽略大小写。' },
  to: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'string', maxLength: 120 }, description: '一个或多个目标单位 ID。' },
}
export const converterBackend: ApplicationBackend = {
  actions: [{ id: 'convert', version: 1, title: '换算单位', description: '将数值换算为指定单位', inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, effect: 'read', background: true }],
  async lifecycle(request) {
    return { status: 'completed', receipt: { appId: request.appId, generation: request.generation, action: request.action } }
  },
  async operation() {
    return null
  },
  async invoke(request, signal) {
    signal?.throwIfAborted()
    if (request.method === 'catalog') {
      return conversionCatalog
    }
    if (request.method === 'convert') {
      return convertUnits(request.arguments)
    }
    if (request.method === 'batch') {
      return batchConvertUnits(request.arguments)
    }
    throw ApplicationErrorCode.APP_METHOD_NOT_FOUND()
  },
}
export function createConverterModule(): ApplicationModule {
  return {
    id: 'converter',
    contractVersion: '1.0',
    manifest: converterManifest,
    interactions: [],
    tools: {
      converter_catalog: { title: '查询单位目录', execution: 'server', effect: 'read', successSummary: '已查询可用单位', definition: definition('converter_catalog', '按需查询单位换算类别和单位 ID。无条件时只列类别摘要；提供类别或关键词后再展开单位，避免一次加载全部单位。', { category: { anyOf: [{ type: 'string', enum: [...conversionCategoryIds] }, { type: 'null' }] }, query: { anyOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }] } }), async handler(value, context) {
        context.signal.throwIfAborted()
        return discoverUnits(value)
      } },
      converter_convert: { title: '换算单位', execution: 'server', effect: 'read', successSummary: '单位换算已完成', definition: definition('converter_convert', '将数值换算为同类别的一个或多个目标单位。后端高精度计算，返回最多 20 位有效数字和近似标记；不能跨类别换算或猜测制式。', properties), async handler(value, context) {
        context.signal.throwIfAborted()
        return convertUnits(value)
      } },
      converter_batch: { title: '批量换算单位', execution: 'server', effect: 'read', successSummary: '批量单位换算已完成', definition: definition('converter_batch', '一次完成最多 30 项单位换算，可以混合类别；每项独立给出类别、值和目标单位。', { items: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } } }), async handler(value, context) {
        context.signal.throwIfAborted()
        return batchConvertUnits(value)
      } },
    },
    skills: { 'unit-conversion': { title: '单位换算', description: '日常、物理、工程、电学和数据单位的单项及批量换算', version: '1.0.0', tools: ['converter_catalog', 'converter_convert', 'converter_batch'], instructions: '根据用户的量选择正确类别，先按需查询目录，再用后端换算工具得到结果，不自行心算编造。单位不明确时先确认：b/B、SI/IEC、美制/英制、温度/温差均不同。不要将电荷直接换成能量、体积换成质量、ppm 换成 mg/L；需要额外条件。不能把月或自然年当固定天数，不能提供实时汇率。保留近似标记和单位制式。工具为服务器只读计算，不需要用户一直保持页面打开；需要展示时可 app_open converter 并带 category/from/to/value。' } },
    agents: [{ id: 'converter', title: '单位换算助手', description: '精确区分量纲、单位制式并完成换算', version: '1.0.0', skillIds: ['unit-conversion'], instructions: '只处理定义明确的单位换算；使用目录与后端工具验证结果，缺少必要条件时先询问。' }],
    navigation: { properties: Object.fromEntries(['category', 'from', 'to', 'value'].map((key) => [key, { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }] }])), parse: parseConverterParams },
  }
}
