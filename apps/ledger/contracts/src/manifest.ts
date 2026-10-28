import type { ApplicationClientInteraction, ApplicationManifest } from '@t-box/app-contracts'
import { applicationIcon } from './icon.js'
/** Host callbacks are private UI interactions, never direct model tools. */
export const ledgerClientInteractions = [
  {
    name: 'application_authorize',
    title: '账本授权',
    purpose: 'authorization',
    description: '在界面输入账本密码并申请短期授权，密码不进入模型上下文。',
    inputSchema: {
      type: 'object',
      properties: {
        ledgerId: { type: 'string' },
        ledgerName: { type: 'string' },
        scope: { type: 'string', enum: ['read', 'write'] },
        purpose: { type: 'string' },
      },
      required: ['ledgerId', 'ledgerName', 'scope', 'purpose'],
      additionalProperties: false,
    },
  },
  {
    name: 'finance_confirm',
    title: '财务操作确认',
    purpose: 'confirmation',
    description: '登记往来或收还款前展示操作明细，由用户确认后继续。',
    inputSchema: {
      type: 'object',
      properties: {
        ledgerId: { type: 'string' },
        ledgerName: { type: 'string' },
        title: { type: 'string' },
        lines: {
          type: 'array',
          maxItems: 220,
          items: { type: 'string', maxLength: 4000 },
        },
      },
      required: ['ledgerId', 'ledgerName', 'title', 'lines'],
      additionalProperties: false,
    },
  },
] as const satisfies readonly ApplicationClientInteraction[]
export const ledgerManifest = {
  id: 'ledger',
  name: '记账',
  description: '记录日常收支，了解每一笔花费。',
  icon: 'ledger',
  iconAsset: applicationIcon,
  color: 'teal',
  version: '1.1.4',
  skillIds: ['bookkeeping'],
} as const satisfies ApplicationManifest
