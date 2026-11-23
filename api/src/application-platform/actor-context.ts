import type { Actor } from '@t-box/app-server-sdk'
import { AsyncLocalStorage } from 'node:async_hooks'

// Local platform adapters can use the authenticated actor without exposing account IDs to app backends.
export const applicationActor = new AsyncLocalStorage<Actor>()
