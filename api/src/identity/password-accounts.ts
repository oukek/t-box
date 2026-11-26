import { EntitySchema } from 'typeorm'

/** Only explicitly provisioned accounts can use the public password login. */
export const PasswordAccount = new EntitySchema<{ userId: string }>({
  name: 'PasswordAccount',
  tableName: 'password_login_accounts',
  columns: { userId: { type: 'char', length: 36, name: 'user_id', primary: true } },
})
export const passwordAccountsExtension = {
  id: '2026-11-26-password-login-accounts',
  tables: ['CREATE TABLE password_login_accounts (user_id char(36) NOT NULL PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'],
}
