import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createDataSource } from '../db/data-source.js'
import { hashPassword } from './crypto.js'
import { AdminStore } from './store.js'

const source = await createDataSource().initialize()
const connection = source.createQueryRunner()
await connection.connect()
try {
  const lockRows = await connection.query(
    'SELECT GET_LOCK(\'tbox_admin_bootstrap\',10) AS acquired',
  )
  if (!(lockRows as { acquired: number }[])[0]?.acquired) {
    throw new Error('Unable to lock administrator bootstrap')
  }
  const store = new AdminStore(source, connection.manager)
  if ((await store.users()).length) {
    console.info('Administrator already exists; no credentials were changed.')
  } else {
    const password = randomBytes(24).toString('base64url')
    const directory = new URL('../../.secrets/', import.meta.url)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    // Write recoverable local credentials before creating the account. Never print passwords.
    writeFileSync(
      new URL('bootstrap-admin.txt', directory),
      `后台地址：http://localhost:5175\n账号：admin\n密码：${password}\n\n首次登录后请在管理员页面修改密码，并删除此文件。\n`,
      { mode: 0o600, flag: 'wx' },
    )
    await store.createUser('admin', await hashPassword(password))
    console.info(
      'Administrator created. Credentials saved to api/.secrets/bootstrap-admin.txt (0600).',
    )
  }
} finally {
  await connection.query('SELECT RELEASE_LOCK(\'tbox_admin_bootstrap\')')
  await connection.release()
  await source.destroy()
}
