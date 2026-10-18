import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createLedgerRows } from '@t-box/ledger-server/ledgers/create'
import { hashPassword } from '../admin/crypto.js'
import { getConfig } from '../config.js'
import { createDataSource } from '../db/data-source.js'

const source = createDataSource(getConfig().mysql)
await source.initialize()
const connection = source.createQueryRunner()
let locked = false
try {
  await connection.connect()
  const [lock] = await connection.query('SELECT GET_LOCK(\'tbox_user_bootstrap\',10) AS acquired')
  if (Number(lock?.acquired) !== 1) {
    throw new Error('无法获取初始普通用户创建锁，请稍后重试')
  }
  locked = true
  const secret = randomBytes(12).toString('base64url')
  const hash = await hashPassword(secret)
  const result = await connection.manager.transaction(async (db) => {
    const [{ count }] = await db.query(
      'SELECT COUNT(*) AS count FROM app_users',
    )
    if (Number(count)) {
      return null
    }
    // Persist credentials before committing the account; never reset a stale file.
    const dir = new URL('../../.secrets/', import.meta.url)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(
      new URL('bootstrap-user.txt', dir),
      `username=tbox\npassword=${secret}\n`,
      { mode: 0o600, flag: 'wx' },
    )
    const userId = randomUUID()
    await db.query(
      'INSERT INTO app_users(id,username,nickname,password_hash) VALUES(?,?,?,?)',
      [userId, 'tbox', '我的账号', hash],
    )
    await createLedgerRows(db, userId, { name: '我的账本', template: 'daily' })
    return userId
  })
  if (result) {
    console.log(
      '初始普通用户和个人账本已创建。凭据存放在 api/.secrets/bootstrap-user.txt。',
    )
  } else {
    console.log('已有普通用户，未修改账号或数据。')
  }
} finally {
  try {
    if (locked) {
      await connection.query('SELECT RELEASE_LOCK(\'tbox_user_bootstrap\')')
    }
  } finally {
    await connection.release()
    await source.destroy()
  }
}
