import { randomBytes, randomUUID } from 'node:crypto'
import { createLedgerRows } from '@t-box/ledger-server/ledgers/create'
import { AppUserEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { hashPassword } from '../admin/crypto.js'
import { createDataSource } from '../db/data-source.js'
import { PasswordAccount } from './password-accounts.js'

const username = process.argv[2] ?? ''
if (!/^[\w.-]{3,64}$/.test(username) || !process.stdout.isTTY) {
  throw new Error('请在服务器交互终端执行 create-password-account.js <新账号名>（3–64 位字母、数字、下划线、点或短横线）')
}
const password = randomBytes(20).toString('base64url')
const passwordHash = await hashPassword(password)
const source = await createDataSource().initialize()
try {
  await source.transaction(async (db) => {
    const id = randomUUID()
    await db.getRepository(AppUserEntity).insert({ id, username, nickname: username.slice(0, 40), passwordHash })
    await db.getRepository(PasswordAccount).insert({ userId: id })
    await createLedgerRows(db, id, { name: '我的账本', template: 'daily' })
  })
  process.stdout.write(`普通用户账号：${username}\n密码：${password}\n`)
} finally {
  await source.destroy()
}
