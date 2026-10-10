/** Manual live probe: no history, prompts, tools or application writes. */
import OpenAI from 'openai'
import { createVault, loadEncryptionKey } from '../src/admin/crypto.js'
import { ConfigurationService } from '../src/admin/service.js'
import { AdminStore } from '../src/admin/store.js'
import { publicRunError } from '../src/chat/errors.js'
import { createDataSource } from '../src/db/data-source.js'

const mode = process.argv[2] ?? 'all'
if (
  !['all', 'responses', 'responses_stream', 'chat_completions'].includes(mode)
) {
  throw new Error(
    'Usage: pnpm --filter @t-box/api test:model-smoke [all|responses|responses_stream|chat_completions]',
  )
}
const source = await createDataSource().initialize()
try {
  const configuration = new ConfigurationService(
    new AdminStore(source),
    createVault(loadEncryptionKey()),
  )
  const config = await configuration.runtime()
  if (!config) {
    throw new Error('请先在后台选择普通会话模型')
  }
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0,
    timeout: 60_000,
    fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }),
  })
  const question = '1+1=多少'
  console.log(JSON.stringify({ model: config.model, question }))
  for (const api of mode === 'all'
    ? ['responses', 'chat_completions']
    : [mode]) {
    const start = Date.now()
    try {
      if (api === 'responses_stream') {
        const result = await client.responses
          .create({ model: config.model, input: question, stream: true })
          .withResponse()
        let answer = ''
        let completed = false
        for await (const event of result.data) {
          if (event.type === 'response.output_text.delta') {
            answer += event.delta
          }
          if (event.type === 'response.completed') {
            completed = true
          }
          if (
            ['response.failed', 'response.incomplete', 'error'].includes(
              event.type,
            )
          ) {
            throw new Error('Responses stream failed or incomplete')
          }
        }
        const ok = completed && Boolean(answer.trim())
        console.log(
          JSON.stringify({
            api,
            ok,
            httpStatus: result.response.status,
            answer,
            durationMs: Date.now() - start,
            requestId: result.request_id,
          }),
        )
        if (!ok) {
          process.exitCode = 1
        }
        continue
      }
      const result =
        api === 'responses'
          ? await client.responses
              .create({ model: config.model, input: question })
              .withResponse()
          : await client.chat.completions
              .create({
                model: config.model,
                messages: [{ role: 'user', content: question }],
              })
              .withResponse()
      const answer =
        'output_text' in result.data
          ? result.data.output_text
          : result.data.choices[0]?.message.content
      const completed =
        'choices' in result.data
          ? result.data.choices[0]?.finish_reason === 'stop'
          : result.data.status === 'completed'
      const ok = completed && Boolean(answer?.trim())
      console.log(
        JSON.stringify({
          api,
          ok,
          httpStatus: result.response.status,
          answer,
          durationMs: Date.now() - start,
          requestId: result.request_id,
        }),
      )
      if (!ok) {
        process.exitCode = 1
      }
    } catch (error) {
      console.log(
        JSON.stringify({
          api,
          ok: false,
          httpStatus: error instanceof OpenAI.APIError ? error.status : null,
          error: publicRunError(error),
          requestId: error instanceof OpenAI.APIError ? error.requestID : null,
          durationMs: Date.now() - start,
        }),
      )
      process.exitCode = 1
    }
  }
} finally {
  await source.destroy()
}
