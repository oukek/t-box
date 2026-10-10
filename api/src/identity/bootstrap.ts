import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { hashPassword } from '../admin/crypto.js'
import { getConfig } from '../config.js'
import { createDataSource } from '../db/data-source.js'
import { LEGACY_LEDGER_ID } from '../db/migrations/SharedLedgers.js'

const source = createDataSource(getConfig().mysql)
await source.initialize()
try {
  const secret = randomBytes(12).toString('base64url')
  const hash = await hashPassword(secret)
  const result = await source.transaction(async (db) => {
    const [book] = await db.query(
      'SELECT owner_id FROM ledgers WHERE id=? FOR UPDATE',
      [LEGACY_LEDGER_ID],
    )
    if (book.owner_id) {
      return null
    }
    const [{ count }] = await db.query(
      'SELECT COUNT(*) AS count FROM app_users',
    )
    if (Number(count)) {
      throw new Error('已有普通用户，请先确认原有账本归属；不会自动认领')
    }
    const userId = randomUUID()
    await db.query(
      'INSERT INTO app_users(id,username,nickname,password_hash) VALUES(?,?,?,?)',
      [userId, 'tbox', '我的账号', hash],
    )
    await db.query(
      'UPDATE ledgers SET owner_id=?,revision=revision+1 WHERE id=?',
      [userId, LEGACY_LEDGER_ID],
    )
    await db.query(
      'INSERT INTO ledger_members(ledger_id,user_id,role) VALUES(?,?,\'owner\')',
      [LEGACY_LEDGER_ID, userId],
    )
    return userId
  })
  if (result) {
    const dir = new URL('../../.secrets/', import.meta.url)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(
      new URL('bootstrap-user.txt', dir),
      `username=tbox\npassword=${secret}\n`,
      { mode: 0o600, flag: 'wx' },
    )
    console.log(
      '普通用户已创建，原有账本已保留。凭据存放在 api/.secrets/bootstrap-user.txt。',
    )
  } else {
    console.log('原有账本已有所有者，未修改账号或数据。')
  }
} finally {
  await source.destroy()
}
