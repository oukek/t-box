import type {
  LedgerAccount,
  LedgerAccountEntry,
  LedgerTransfer,
} from '@t-box/ledger-contracts'
import type { Principal } from '../ledgers/types.js'
import { randomUUID } from 'node:crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { choice } from '@t-box/server-foundation/input'
import { amount, cents, money } from '../finance/money.js'
import { isoTime } from '../ledgers/time.js'
import { date, note, object, text, today } from '../ledgers/validation.js'
import {
  LedgerAccountEntity,
  LedgerAccountEntryEntity,
  LedgerTransferEntity,
} from '../persistence/accounts-entities.js'
import { project } from '../statistics/projection.js'
import { parseId } from '../validation.js'
import { activeAccount, postAccount } from './account-posting.js'
import { FeatureService, notFound } from './base.js'

export class AccountService extends FeatureService {
  async list(actor: Principal, book: string): Promise<LedgerAccount[]> {
    await this.read(actor, book)
    // native-sql: aggregate/correlated snapshot; preserve join cardinality and exact monetary totals
    const rows = await this.db.query<
      (Omit<LedgerAccount, 'archived'> & { archived: number | boolean })[]
    >(
      'SELECT a.id,a.name,a.kind,a.archived,COALESCE(SUM(IF(e.entry_date<=?,e.amount,0)),0) AS balance FROM ledger_accounts a LEFT JOIN ledger_account_entries e ON e.ledger_id=a.ledger_id AND e.account_id=a.id WHERE a.ledger_id=? GROUP BY a.id,a.name,a.kind,a.archived ORDER BY a.archived,a.created_at',
      [today(), book],
    )
    return rows.map((r) => ({ ...r, archived: !!Number(r.archived) }))
  }

  async create(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ['name', 'kind', 'openingBalance', 'date'])
    const name = text(v.name, '账户名称', 60)
    const d = date(v.date)
    if (!['cash', 'bank', 'wallet', 'other'].includes(v.kind as string)) {
      invalid('kind', '账户类型无效')
    }
    const signed = String(v.openingBalance)
    if (!/^-?(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(signed)) {
      invalid('openingBalance', '期初余额格式无效')
    }
    return this.finance.operations.run(
      actor,
      book,
      key,
      'account.created',
      v,
      async (db, a) => {
        this.manage(a)
        const id = randomUUID()
        await db.getRepository(LedgerAccountEntity).insert({
          id,
          ledger_id: book,
          name,
          kind: choice(v.kind, 'kind', ['cash', 'bank', 'wallet', 'other']),
          created_by: actor.user.id,
        })
        await postAccount(
          db,
          book,
          id,
          id,
          d,
          cents(signed),
          '期初余额',
          actor.user.id,
        )
        return {
          id,
          name,
          kind: choice(v.kind, 'kind', ['cash', 'bank', 'wallet', 'other']),
          balance: money(cents(signed)),
          archived: false,
        }
      },
    )
  }

  async update(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ['name', 'archived'])
    return this.finance.operations.run(
      actor,
      book,
      key,
      'account.updated',
      { id, ...v },
      async (db, a) => {
        this.manage(a)
        const r = await db.getRepository(LedgerAccountEntity).findOne({
          select: {
            id: true,
            ledger_id: true,
            name: true,
            kind: true,
            archived: true,
            created_by: true,
            created_at: true,
          },
          where: { ledger_id: book, id },
        })
        if (!r) {
          notFound()
        }
        if (v.archived !== undefined && typeof v.archived !== 'boolean') {
          invalid('archived', '状态无效')
        }
        await db.getRepository(LedgerAccountEntity).update(
          { id },
          {
            name: v.name === undefined ? r.name : text(v.name, '名称', 60),
            archived: v.archived ?? r.archived,
          },
        )
        return { id }
      },
    )
  }

  async entries(
    actor: Principal,
    book: string,
    id: string,
  ): Promise<LedgerAccountEntry[]> {
    await this.read(actor, book)
    const r = await this.db
      .getRepository(LedgerAccountEntity)
      .findOne({ select: { id: true }, where: { ledger_id: book, id } })
    if (!r) {
      notFound()
    }
    return (
      await this.db
        .getRepository(LedgerAccountEntryEntity)
        .find({
          select: {
            id: true,
            subject_id: true,
            entry_date: true,
            amount: true,
            note: true,
            created_at: true,
          },
          where: { ledger_id: book, account_id: id },
          order: { entry_date: 'DESC', created_at: 'DESC' },
          take: 1000,
        })
        .then((rows) =>
          rows.map((row) => ({
            id: row.id,
            subjectId: row.subject_id,
            date: row.entry_date,
            amount: row.amount,
            note: row.note,
            createdAt: row.created_at,
          })),
        )
    ).map((r) => ({ ...r, createdAt: isoTime(r.createdAt) }))
  }

  async reconcile(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, ['balance', 'date', 'note'])
    const d = date(v.date)
    const n = note(v.note)
    const target = String(v.balance)
    if (!/^-?(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(target)) {
      invalid('balance', '余额格式无效')
    }
    return this.finance.operations.run(
      actor,
      book,
      key,
      'account.reconciled',
      { id, ...v },
      async (db, a) => {
        this.manage(a)
        await activeAccount(db, book, id)
        const [r] = await db
          .createQueryBuilder()
          .select('COALESCE(SUM(amount),0) balance')
          .from('ledger_account_entries', 'ledger_account_entries')
          .where('ledger_id=:p0 AND account_id=:p1 AND entry_date<=:p2')
          .setParameters({ p0: book, p1: id, p2: d })
          .getRawMany()
        const delta = cents(target) - cents(r.balance)
        const subject = randomUUID()
        await postAccount(
          db,
          book,
          id,
          subject,
          d,
          delta,
          `余额核对：${n}`.slice(0, 200),
          actor.user.id,
        )
        return { id, adjustment: money(delta), balance: money(cents(target)) }
      },
    )
  }

  async transfer(
    actor: Principal,
    book: string,
    key: string | undefined,
    value: unknown,
  ) {
    const v = object(value, [
      'attachmentResourceIds',
      'fromAccountId',
      'toAccountId',
      'amount',
      'date',
      'note',
    ])
    const from = parseId(v.fromAccountId)
    const to = parseId(v.toAccountId)
    const sum = amount(v.amount)
    const d = date(v.date)
    const n = note(v.note)
    if (from === to) {
      invalid('toAccountId', '转出转入账户不能相同')
    }
    return this.finance.operations.run(
      actor,
      book,
      key,
      'transfer.created',
      v,
      async (db) => {
        await activeAccount(db, book, from)
        await activeAccount(db, book, to)
        const id = randomUUID()
        await db.getRepository(LedgerTransferEntity).insert({
          id,
          ledger_id: book,
          from_account_id: from,
          to_account_id: to,
          amount: sum,
          transfer_date: d,
          note: n,
          created_by: actor.user.id,
        })
        await postAccount(db, book, from, id, d, -cents(sum), n, actor.user.id)
        await postAccount(db, book, to, id, d, cents(sum), n, actor.user.id)
        await project(db, book, {
          subjectId: id,
          kind: 'transfer',
          date: d,
          note: n,
          createdBy: actor.user.id,
        })
        return {
          id,
          fromAccountId: from,
          toAccountId: to,
          amount: sum,
          date: d,
          note: n,
        }
      },
    )
  }

  async transfers(actor: Principal, book: string): Promise<LedgerTransfer[]> {
    await this.read(actor, book)
    return this.db
      .getRepository(LedgerTransferEntity)
      .find({
        select: {
          id: true,
          from_account_id: true,
          to_account_id: true,
          amount: true,
          transfer_date: true,
          note: true,
          reversed: true,
        },
        where: { ledger_id: book },
        order: { transfer_date: 'DESC', created_at: 'DESC' },
        take: 500,
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          fromAccountId: row.from_account_id,
          toAccountId: row.to_account_id,
          amount: row.amount,
          date: row.transfer_date,
          note: row.note,
          reversed: Boolean(Number(row.reversed)),
        })),
      )
  }

  async reverse(
    actor: Principal,
    book: string,
    id: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      'transfer.reversed',
      { id },
      async (db, a) => {
        const r = await db.getRepository(LedgerTransferEntity).findOne({
          select: {
            id: true,
            ledger_id: true,
            from_account_id: true,
            to_account_id: true,
            amount: true,
            transfer_date: true,
            note: true,
            reversed: true,
            created_by: true,
            created_at: true,
          },
          where: { ledger_id: book, id },
        })
        if (!r) {
          notFound()
        }
        this.access.assertAuthor(a.role, r.created_by, actor.user.id)
        if (Number(r.reversed)) {
          return { id }
        }
        await db
          .getRepository(LedgerTransferEntity)
          .update({ id }, { reversed: true })
        await postAccount(
          db,
          book,
          r.from_account_id,
          id,
          r.transfer_date,
          cents(r.amount),
          '撤销转账',
          actor.user.id,
        )
        await postAccount(
          db,
          book,
          r.to_account_id,
          id,
          r.transfer_date,
          -cents(r.amount),
          '撤销转账',
          actor.user.id,
        )
        return { id }
      },
    )
  }
}
