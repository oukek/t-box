import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { APPLICATION_FRAME_SANDBOX } from '../../app/src/core/app-runtime/sandbox'

test('登录、OS、设备会话、恢复设置与资源容量在桌面和手机上可用', async ({ page, request }) => {
  if (!/^(?:t_box_ci|t_box_test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
    throw new Error('Browser tests require a disposable database')
  }
  const username = `browser_${randomUUID().replaceAll('-', '').slice(0, 20)}`
  const password = 'test-only-123'
  const registered = await request.post('/api/v1/auth/register', { data: { username, password, nickname: '浏览器验收' } })
  expect(registered.status()).toBe(201)
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await page.context().setOffline(true)
  await page.reload()
  await expect(page.getByText('当前离线，联网后可继续。记账、AI 和支付操作需要网络。')).toBeVisible()
  await expect(page.getByLabel('账号', { exact: true })).toBeVisible()
  await page.context().setOffline(false)
  await page.reload()
  await page.getByLabel('账号', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('region', { name: '首页对话' })).toBeVisible()
  const navigation = page.getByRole('navigation', { name: '主要导航' })
  await navigation.getByRole('button', { name: 'OS', exact: true }).click()
  await expect(page.getByRole('region', { name: 'OS 应用桌面' })).toBeVisible()
  await page.getByRole('button', { name: '打开设置', exact: true }).click()
  await expect(navigation).toBeHidden()
  await page.getByRole('button', { name: '查看账号信息与安全设置' }).click()
  await page.getByRole('button', { name: /登录设备/ }).click()
  const devices = page.getByRole('dialog', { name: '登录设备', exact: true })
  await expect(devices.getByText('当前设备', { exact: true })).toBeVisible()
  await devices.getByRole('button', { name: '关闭', exact: true }).last().click()
  await page.getByRole('button', { name: /账号恢复码/ }).click()
  const recovery = page.getByRole('dialog', { name: '账号恢复码', exact: true })
  await expect(recovery.getByRole('button', { name: /生成.*恢复码/ })).toBeDisabled()
  await recovery.getByRole('button', { name: '取消', exact: true }).click()
  // Deliberately no recovery code generation, session revocation, AI call or payment.
  await page.goto('/#/ai/resources')
  await expect(page.getByText(/已用 .*个文件/)).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  expect(overflow, '页面不应横向溢出').toBe(false)
  await page.reload()
  await expect(page.getByText(/已用 .*个文件/)).toBeVisible()
})

test('独立应用沙箱允许本地表单 submit 事件，CSP 继续阻止原生表单导航', async ({ page }) => {
  await page.goto('/')
  const content = `<html><head><meta http-equiv="Content-Security-Policy" content="form-action 'none'"></head><body>
    <form><label>数字<input aria-label="数字" value="1"></label><button type="submit">计算</button></form>
    <output aria-label="提交结果">尚未计算</output>
    <script>let count = 0; document.querySelector('form').addEventListener('submit', event => {
      event.preventDefault(); document.querySelector('output').textContent = '已计算 ' + (++count) + ' 次';
    });</script></body></html>`
  await page.setContent('<iframe title="表单沙箱回归"></iframe>')
  await page.locator('iframe').evaluate((frame, values) => {
    const element = frame as HTMLIFrameElement
    element.setAttribute('sandbox', values.sandbox)
    element.srcdoc = values.content
  }, { sandbox: APPLICATION_FRAME_SANDBOX, content })
  const frame = page.frameLocator('iframe')
  await frame.getByRole('button', { name: '计算', exact: true }).click()
  await expect(frame.getByLabel('提交结果')).toHaveText('已计算 1 次')
  await frame.getByLabel('数字').press('Enter')
  await expect(frame.getByLabel('提交结果')).toHaveText('已计算 2 次')
  // A non-intercepted native submission remains blocked by the artifact policy.
  await frame.locator('form').evaluate((form) => {
    const replacement = form.cloneNode(true)
    form.replaceWith(replacement)
  })
  await frame.getByRole('button', { name: '计算', exact: true }).click()
  await expect(frame.getByLabel('提交结果')).toHaveText('已计算 2 次')
  await expect(frame.getByLabel('数字')).toBeVisible()
})
