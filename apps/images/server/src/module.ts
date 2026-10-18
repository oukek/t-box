import type {
  ApplicationModule,
  ApplicationToolContext as ToolContext,
} from '@t-box/app-server-sdk'
import type { Resource } from '@t-box/shared'
import type { ImageToolPort } from './ports.js'
import { definition } from '@t-box/app-server-sdk'
import { APPLICATION_CONTRACT_VERSION } from '@t-box/shared'
import { ErrorCode } from './error-codes.js'

export function createImagesModule(images?: ImageToolPort): ApplicationModule {
  const operation = async (ctx: ToolContext) => {
    if (!images || !ctx.actor) {
      throw ErrorCode.IMAGE_MODEL_REQUIRED('请先配置图片模型并登录')
    }
    return ctx.use('images.operation', async () =>
      images.forRun(ctx.actor!, ctx.signal, ctx.session.task?.id))
  }
  const attachments = (result: unknown) =>
    (result as { resources?: Resource[] })?.resources || []
  const completedImage = (result: import('@t-box/shared').ToolResult) => {
    if (!result.ok) {
      return false
    }
    const resources = attachments(result.data)
    return (
      resources.length === 1 &&
      typeof resources[0]?.id === 'string' &&
      Boolean(resources[0].id) &&
      typeof resources[0].mimeType === 'string' &&
      resources[0].mimeType.startsWith('image/') &&
      typeof resources[0].size === 'number' &&
      resources[0].size > 0
    )
  }
  return {
    id: 'images',
    contractVersion: APPLICATION_CONTRACT_VERSION,
    agents: [
      {
        id: 'images',
        title: '图片助手',
        description: '使用图片模型生成或编辑用户资源',
        version: '1.0.0',
        skillIds: ['image_processing'],
        instructions:
          '你是图片工具协调助手，当前会话模型只理解需求、构造函数调用和总结真实回执，不负责生成像素。实际生成、编辑必须调用 images_generate/images_edit，由工具选择独立图片模型；不要使用模型内置 image_generation。用户明确要求图片创作时才执行。区分描述图片与生成编辑请求。使用真实附件资源 ID；不擅自增加生成次数。返回工具实际生成的资源，不编造链接。',
      },
    ],
    skills: {
      image_processing: {
        title: '图片生成与编辑',
        description: '按要求生成图片，或编辑会话中的图片',
        version: '1.0.0',
        tools: ['images_generate', 'images_edit'],
        instructions:
          '只有用户明确要求生成或修改图片才调用图片工具；看图、描述或识别由普通会话模型处理。编辑必须使用本会话附件或工具结果返回的真实资源 ID，不能编造。生成会消耗模型额度，不自动重复调用。失败如实说明，不能伪造图片或下载链接。',
      },
    },
    tools: {
      images_generate: {
        definition: definition(
          'images_generate',
          '根据用户明确要求生成一张图片，使用独立图片模型，结果存入我的资源。',
          { prompt: { type: 'string', maxLength: 2000 } },
        ),
        title: '生成图片',
        execution: 'server',
        effect: 'external',
        preview: {
          kind: 'image',
          width: 1024,
          height: 1024,
          label: '正在生成图片',
        },
        successSummary: '图片已生成并保存',
        completionSummary: (result) =>
          completedImage(result) ? '图片已生成并保存。' : undefined,
        writeFingerprint: JSON.stringify,
        attachments,
        async validate(args, ctx) {
          await (await operation(ctx)).prepare(args)
        },
        async handler(args, ctx) {
          return (await operation(ctx))(args)
        },
      },
      images_edit: {
        definition: definition(
          'images_edit',
          '按用户说明修改已有图片，资源 ID 必须来自会话附件或工具结果。',
          {
            prompt: { type: 'string', maxLength: 2000 },
            resourceIds: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: { type: 'string' },
            },
          },
        ),
        title: '编辑图片',
        execution: 'server',
        effect: 'external',
        preview: {
          kind: 'image',
          width: 1024,
          height: 1024,
          label: '正在编辑图片',
        },
        successSummary: '图片已编辑并保存',
        completionSummary: (result) =>
          completedImage(result) ? '图片已编辑并保存。' : undefined,
        writeFingerprint: JSON.stringify,
        attachments,
        async validate(args, ctx) {
          const visible = new Set(
            ctx.session.messages.flatMap(
              (message) =>
                message.attachments?.map((resource) => resource.id) || [],
            ),
          )
          const ids = (args as { resourceIds?: unknown }).resourceIds
          if (!Array.isArray(ids) || ids.some((id) => !visible.has(id))) {
            throw ErrorCode.IMAGE_REFERENCE_REQUIRED()
          }
          await (await operation(ctx)).prepare(args, true)
        },
        async handler(args, ctx) {
          return (await operation(ctx))(args, true)
        },
      },
    },
  }
}
