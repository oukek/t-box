import type { JsonDocument } from '@t-box/server-foundation/persistence/columns'
import type {
  DailyReconciliation,
  ReconciliationDifference,
  RefundStatus,
  WechatPaymentMode,
} from '@t-box/shared'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredPaymentConfiguration {
  id: string
  public_json: JsonDocument
  secret_cipher: string
  administrator_id: string
  created_at: string
  version: string | number
}

export const PaymentConfigurationEntity =
  new EntitySchema<StoredPaymentConfiguration>({
    name: 'PaymentConfiguration',
    tableName: 'payment_configurations',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      public_json: { type: 'json', name: 'public_json' },
      secret_cipher: {
        type: 'mediumtext',
        name: 'secret_cipher',
        select: false,
      },
      administrator_id: { type: 'char', name: 'administrator_id', length: 36 },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
      version: { type: 'bigint', generated: 'increment', unsigned: true },
    },
    indices: [{ name: 'version', columns: ['version'], unique: true }],
  })

export interface StoredPaymentOauthState {
  state_hash: string
  user_id: string
  order_id: string
  configuration_id: string
  consumed: number | boolean
  expires_at: string
}

export const PaymentOauthStateEntity =
  new EntitySchema<StoredPaymentOauthState>({
    name: 'PaymentOauthState',
    tableName: 'payment_oauth_states',
    columns: {
      state_hash: {
        type: 'char',
        name: 'state_hash',
        length: 64,
        primary: true,
      },
      user_id: { type: 'char', name: 'user_id', length: 36 },
      order_id: { type: 'char', name: 'order_id', length: 36 },
      configuration_id: { type: 'char', name: 'configuration_id', length: 36 },
      consumed: { type: 'tinyint' },
      expires_at: {
        type: 'datetime',
        name: 'expires_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [
      { name: 'fk_pay_oauth_order', columns: ['order_id'] },
      { name: 'fk_pay_oauth_user', columns: ['user_id'] },
    ],
  })

export interface StoredPaymentOrder {
  id: string
  user_id: string
  request_key: string
  channel: string
  amount_cents: number
  currency: 'CNY'
  status: 'pending' | 'paid' | 'closed'
  transaction_id: string | null
  created_at: string
  expires_at: string
  paid_at: string | null
  configuration_id: string | null
  payment_mode: WechatPaymentMode | null
  next_query_at: string | null
  bonus_cents: number
}

export const PaymentOrderEntity = new EntitySchema<StoredPaymentOrder>({
  name: 'PaymentOrder',
  tableName: 'payment_orders',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    user_id: { type: 'char', name: 'user_id', length: 36 },
    request_key: { type: 'varchar', name: 'request_key', length: 80 },
    channel: { type: 'varchar', length: 20 },
    amount_cents: { type: 'int', name: 'amount_cents' },
    currency: { type: 'char', length: 3 },
    status: { type: 'enum', enum: ['pending', 'paid', 'closed'] },
    transaction_id: {
      type: 'varchar',
      name: 'transaction_id',
      length: 100,
      nullable: true,
    },
    created_at: {
      type: 'datetime',
      name: 'created_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
    expires_at: {
      type: 'datetime',
      name: 'expires_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
    paid_at: {
      type: 'datetime',
      name: 'paid_at',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
    configuration_id: {
      type: 'char',
      name: 'configuration_id',
      length: 36,
      nullable: true,
    },
    payment_mode: {
      type: 'varchar',
      name: 'payment_mode',
      length: 10,
      nullable: true,
    },
    next_query_at: {
      type: 'datetime',
      name: 'next_query_at',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
    bonus_cents: { type: 'int', name: 'bonus_cents' },
  },
  indices: [
    { name: 'ix_orders_user', columns: ['user_id', 'created_at'] },
    {
      name: 'ux_gateway_transaction',
      columns: ['channel', 'transaction_id'],
      unique: true,
    },
    {
      name: 'ux_order_request',
      columns: ['user_id', 'request_key'],
      unique: true,
    },
  ],
})

export interface StoredPaymentReconciliation {
  id: string
  day: string
  merchant_hash: string
  configuration_id: string
  status: DailyReconciliation['status']
  row_count: number
  difference_count: number
  details_json: ReconciliationDifference[] | null
  statement_sha1: string | null
  error: string | null
  attempts: number
  lease_owner: string | null
  lease_until: string | null
  next_attempt_at: string
  updated_at: string
}

export const PaymentReconciliationEntity =
  new EntitySchema<StoredPaymentReconciliation>({
    name: 'PaymentReconciliation',
    tableName: 'payment_reconciliations',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      day: { type: 'date' },
      merchant_hash: { type: 'char', name: 'merchant_hash', length: 64 },
      configuration_id: { type: 'char', name: 'configuration_id', length: 36 },
      status: { type: 'varchar', length: 24 },
      row_count: { type: 'int', name: 'row_count' },
      difference_count: { type: 'int', name: 'difference_count' },
      details_json: { type: 'json', name: 'details_json', nullable: true },
      statement_sha1: {
        type: 'char',
        name: 'statement_sha1',
        length: 40,
        nullable: true,
      },
      error: { type: 'varchar', length: 200, nullable: true },
      attempts: { type: 'int' },
      lease_owner: {
        type: 'char',
        name: 'lease_owner',
        length: 36,
        nullable: true,
      },
      lease_until: {
        type: 'datetime',
        name: 'lease_until',
        nullable: true,
        precision: 3,
        transformer: utcSqlDateTime,
      },
      next_attempt_at: {
        type: 'datetime',
        name: 'next_attempt_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
      updated_at: {
        type: 'datetime',
        name: 'updated_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [
      { name: 'merchant_day', columns: ['merchant_hash', 'day'], unique: true },
      {
        name: 'reconciliation_pending',
        columns: ['status', 'next_attempt_at'],
      },
    ],
  })

export interface StoredPaymentRefund {
  id: string
  order_id: string
  request_key: string
  administrator_id: string
  reason: string
  amount_cents: number
  credit_micro: string
  status: RefundStatus
  refund_id: string | null
  submitted: number | boolean
  error: string | null
  lease_owner: string | null
  lease_until: string | null
  next_query_at: string
  created_at: string
  updated_at: string
  succeeded_at: string | null
}

export const PaymentRefundEntity = new EntitySchema<StoredPaymentRefund>({
  name: 'PaymentRefund',
  tableName: 'payment_refunds',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    order_id: { type: 'char', name: 'order_id', length: 36 },
    request_key: { type: 'varchar', name: 'request_key', length: 64 },
    administrator_id: { type: 'char', name: 'administrator_id', length: 36 },
    reason: { type: 'varchar', length: 80 },
    amount_cents: { type: 'int', name: 'amount_cents' },
    credit_micro: { type: 'bigint', name: 'credit_micro' },
    status: { type: 'varchar', length: 24 },
    refund_id: {
      type: 'varchar',
      name: 'refund_id',
      length: 64,
      nullable: true,
    },
    submitted: { type: 'tinyint' },
    error: { type: 'varchar', length: 200, nullable: true },
    lease_owner: {
      type: 'char',
      name: 'lease_owner',
      length: 36,
      nullable: true,
    },
    lease_until: {
      type: 'datetime',
      name: 'lease_until',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
    next_query_at: {
      type: 'datetime',
      name: 'next_query_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
    created_at: {
      type: 'datetime',
      name: 'created_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
    updated_at: {
      type: 'datetime',
      name: 'updated_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
    succeeded_at: {
      type: 'datetime',
      name: 'succeeded_at',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
  },
  indices: [
    { name: 'refund_gateway', columns: ['refund_id'], unique: true },
    { name: 'refund_pending', columns: ['status', 'next_query_at'] },
    {
      name: 'refund_request',
      columns: ['order_id', 'request_key'],
      unique: true,
    },
    { name: 'refund_success', columns: ['succeeded_at'] },
  ],
})

export interface StoredPaymentSetting {
  id: number
  configuration_id: string | null
}

export const PaymentSettingEntity = new EntitySchema<StoredPaymentSetting>({
  name: 'PaymentSetting',
  tableName: 'payment_settings',
  columns: {
    id: { type: 'int', primary: true },
    configuration_id: {
      type: 'char',
      name: 'configuration_id',
      length: 36,
      nullable: true,
    },
  },
  indices: [],
})

export interface StoredPaymentWechatUser {
  user_id: string
  app_id: string
  openid_cipher: string
  updated_at: string
}

export const PaymentWechatUserEntity =
  new EntitySchema<StoredPaymentWechatUser>({
    name: 'PaymentWechatUser',
    tableName: 'payment_wechat_users',
    columns: {
      user_id: { type: 'char', name: 'user_id', length: 36, primary: true },
      app_id: { type: 'varchar', name: 'app_id', length: 32, primary: true },
      openid_cipher: { type: 'text', name: 'openid_cipher' },
      updated_at: {
        type: 'datetime',
        name: 'updated_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [],
  })
