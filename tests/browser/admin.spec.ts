import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'

const apiOrigin = `http://127.0.0.1:${process.env.TBOX_TEST_API_PORT || '13000'}`
const adminOrigin = `http://127.0.0.1:${process.env.TBOX_TEST_ADMIN_PORT || '15175'}`

test('OSS 后台跨来源登录、编辑待发布更新信息、发布和退出', async ({ page }) => {
  if (!/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
    throw new Error('Select a disposable database for administration acceptance')
  }
  // Load the already-built ESM API through native import, outside Playwright's CommonJS TS transform.
  const { hashPassword } = await import(pathToFileURL(resolve('api/dist/admin/crypto.js')).href)
  const { AdminStore } = await import(pathToFileURL(resolve('api/dist/admin/store.js')).href)
  const { createDataSource } = await import(pathToFileURL(resolve('api/dist/db/data-source.js')).href)
  const { applicationArtifactRoot } = await import(pathToFileURL(resolve('api/dist/application-platform/artifacts.js')).href)
  const source = await createDataSource().initialize()
  const username = `browser_admin_${randomUUID().slice(0, 8)}`
  const password = 'browser-admin-test-only-123'
  const appId = `test_browser_${randomUUID().replaceAll('-', '').slice(0, 12)}`
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
    const post = async (path: string, data: unknown) => {
      const response = await page.request.post(apiOrigin + '/api/v1/admin' + path, { headers: { 'x-admin-request': '1' }, data })
      expect(response.ok(), await response.text()).toBe(true)
      return (await response.json()).data
    }
    const artifact = await post(`/applications/${appId}/artifacts`, { files: [{ path: 'index.html', content: Buffer.from('<title>更新信息验收</title>').toString('base64') }] })
    const release = await post('/application-releases', { appId, kind: 'user', version: '1.2.3', name: '更新信息验收', description: '浏览器测试', icon: 'apps', color: 'blue', runtime: 'web', artifact: artifact.digest, releaseNotes: '' })
    await post(`/application-releases/${release.releaseId}/transitions`, { action: 'submit', revision: 1, expectedCurrentReleaseId: null })
    await page.goto(adminOrigin + '/#/applications')
    await page.getByLabel('搜索应用').fill(appId)
    await page.getByRole('button', { name: /更新信息验收/ }).click()
    await page.getByRole('button', { name: '编辑更新信息', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '编辑更新信息', exact: true })
    await expect(editor.getByText('更新信息验收 · v1.2.3', { exact: true })).toBeVisible()
    await expect(editor.getByLabel('版本号', { exact: true })).toHaveCount(0)
    await expect(editor.getByLabel('构建产物', { exact: true })).toHaveCount(0)
    await editor.getByLabel('更新说明', { exact: true }).fill('后台填写的更新说明')
    await editor.getByLabel('弹窗标题', { exact: true }).fill('后台更新提示')
    await editor.getByRole('button', { name: '保存更新信息', exact: true }).click()
    await expect(editor).toBeHidden()
    await expect(page.getByText('后台填写的更新说明', { exact: true })).toBeVisible()
    await page.reload()
    await page.getByLabel('搜索应用').fill(appId)
    await page.getByRole('button', { name: /更新信息验收/ }).click()
    await page.getByRole('button', { name: '发布', exact: true }).click()
    await page.getByRole('dialog', { name: '发布版本？', exact: true }).getByRole('button', { name: '确认发布', exact: true }).click()
    await expect(page.getByText('线上版本', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '编辑更新信息', exact: true })).toHaveCount(0)
    const [stored] = await source.query('SELECT definition,release_notes FROM application_releases WHERE app_id=?', [appId])
    const definition = typeof stored.definition === 'string' ? JSON.parse(stored.definition) : stored.definition
    expect(definition.manifest.version).toBe('1.2.3')
    expect(definition.runtime.integrity).toBe('sha256-' + artifact.digest)
    expect(definition.updatePrompt.title).toBe('后台更新提示')
    expect(stored.release_notes).toBe('后台填写的更新说明')
    await page.getByRole('button', { name: /退出/ }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: /退出/ }).click()
    await expect(page.getByLabel('账号', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('账号', { exact: true })).toBeVisible()
  } finally {
    await source.query('DELETE FROM application_publication_events WHERE app_id=?', [appId])
    await source.query('DELETE FROM application_releases WHERE app_id=?', [appId])
    await source.query('DELETE FROM application_registry WHERE app_id=?', [appId])
    await rm(resolve(applicationArtifactRoot, appId), { recursive: true, force: true })
    if (id) {
      await source.query('DELETE FROM admin_sessions WHERE admin_id=?', [id])
      await source.query('DELETE FROM admin_users WHERE id=?', [id])
    }
    await source.destroy()
  }
})
