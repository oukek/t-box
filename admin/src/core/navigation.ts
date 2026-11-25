export const navigationGroups = [
  {
    id: 'ai',
    title: '模型与 AI',
    symbol: 'model',
    pages: ['providers', 'models', 'workflow'],
  },
  {
    id: 'applications',
    title: '应用管理',
    symbol: 'grid',
    pages: ['applications', 'system-releases', 'ledger-categories', 'holidays'],
  },
  {
    id: 'operations',
    title: '用户与运营',
    symbol: 'users',
    pages: ['billing', 'promotions', 'support'],
  },
  {
    id: 'commerce',
    title: '交易与计费',
    symbol: 'model',
    pages: ['packages', 'payments'],
  },
  {
    id: 'platform',
    title: '平台管理',
    symbol: 'lock',
    pages: ['operations', 'configuration', 'wechat-login', 'users'],
  },
] as const
export type AdminPage = (typeof navigationGroups)[number]['pages'][number]
