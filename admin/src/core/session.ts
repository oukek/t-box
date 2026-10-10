import { ref } from 'vue'
import { request, RequestError, save } from './api'

export const administrator = ref<{ id: string, username: string } | null>(null)
export async function restoreSession() {
  try {
    administrator.value = await request('/session')
  } catch (error) {
    if (!(error instanceof RequestError && error.status === 401)) {
      throw error
    }
  }
}
export async function login(username: string, password: string) {
  administrator.value = await save('/session', { username, password })
}
export async function logout() {
  await request('/session', { method: 'DELETE' })
  administrator.value = null
}
