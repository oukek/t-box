import type { ApplicationModule } from '@t-box/app-server-sdk'
import { manifest } from '@t-box/todo-contracts'

export function createTodoModule(): ApplicationModule {
  return {
    id: 'todo',
    contractVersion: '1.0',
    manifest,
    skills: {},
    tools: {},
    interactions: [],
    navigation: { properties: {}, parse: () => ({}) },
  }
}

export { todoEntities } from './entities.js'
export { applicationRelease } from './release.js'
export { todoSchema } from './schema.js'

export { TodoService } from './workspace.js'
