import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'

const apiOrigin = `http://127.0.0.1:${process.env.TBOX_TEST_API_PORT || '13000'}`
const adminOrigin = `http://127.0.0.1:${process.env.TBOX_TEST_ADMIN_PORT || '15175'}`

test('OSS 后台通过跨来源 Cookie 登录、刷新恢复会话和退出', async ({ page }) => {
  if (!/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
    throw new Error('Select a disposable database for administration acceptance')
  }
  // Load the already-built ESM API through native import, outside Playwright's CommonJS TS transform.
  const { hashPassword } = await import(pathToFileURL(resolve('api/dist/admin/crypto.js')).href)
  const { AdminStore } = await import(pathToFileURL(resolve('api/dist/admin/store.js')).href)
  const { createDataSource } = await import(pathToFileURL(resolve('api/dist/db/data-source.js')).href)
  const source = await createDataSource().initialize()
  const username = `browser_admin_${randomUUID().slice(0, 8)}`
  const password = 'browser-admin-test-only-123'
  let id = ''
  const calls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/admin')) {
      calls.push(request.url())
    }
  })
  try {
    id = await new AdminStore(source).createUser(username, await hashPassword(password))
    await page.goto(adminOrigin)
    await page.getByLabel('账号', { exact: true }).fill(username)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '登录 →', exact: true }).click()
    await expect(page.getByRole('navigation', { name: '后台导航' })).toBeVisible()
    const cookie = (await page.context().cookies(apiOrigin + '/api/v1/admin/session')).find((value) => value.name === 'tbox_admin')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Strict')
    await page.reload()
    await expect(page.getByRole('navigation', { name: '后台导航' })).toBeVisible()
    expect(calls.length).toBeGreaterThan(2)
    expect(calls.every((url) => url.startsWith(apiOrigin + '/api/v1/admin'))).toBe(true)
    await page.getByRole('button', { name: /退出/ }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: /退出/ }).click()
    await expect(page.getByLabel('账号', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('账号', { exact: true })).toBeVisible()
  } finally {
    if (id) {
      await source.query('DELETE FROM admin_sessions WHERE admin_id=?', [id])
      await source.query('DELETE FROM admin_users WHERE id=?', [id])
    }
    await source.destroy()
  }
})
