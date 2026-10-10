export interface RechargeBonusRule {
  threshold: string
  bonus: string
}
export interface RechargePreset {
  amount: string
  bonusAmount: string
  enabled: boolean
}
export interface RechargeConfiguration {
  presets: RechargePreset[]
  customEnabled: boolean
  bonusRules: RechargeBonusRule[]
  minAmount: string
  maxAmount: string
}
export interface AdminRechargeConfiguration extends RechargeConfiguration {
  revision: number
  updatedAt: string | null
}
export interface AiFeeSchedule {
  currency: 'CNY'
  tokenUnit: number
  conversation: { inputPrice: string, outputPrice: string } | null
  image: { imagePrice: string } | null
  titleFree: true
}
/** Integer cents for preview and validation; never trust client-computed bonuses. */
export function rechargeCents(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,5}(?:\.\d{1,2})?$/.test(value)) {
    return null
  }
  const [whole, fraction = ''] = value.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return cents >= 100 && cents <= 1_000_000 ? cents : null
}
export function rechargeBonusCents(
  amount: number,
  rules: readonly RechargeBonusRule[],
): number {
  let threshold = 0
  let bonus = 0
  for (const rule of rules) {
    const t = rechargeCents(rule.threshold)
    const b = /^\d{1,5}(?:\.\d{1,2})?$/.test(rule.bonus)
      ? (() => {
          const [whole, fraction = ''] = rule.bonus.split('.')
          return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
        })()
      : 0
    if (t !== null && t <= amount && t > threshold) {
      threshold = t
      bonus = b
    }
  }
  return bonus
}

/** Exact-package promotion first; threshold bonuses apply only to custom amounts. */
export function rechargeOfferBonusCents(
  amount: number,
  config: RechargeConfiguration,
): number | null {
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 1_000_000) {
    return null
  }
  const preset = config.presets.find(
    (p) => p.enabled && rechargeCents(p.amount) === amount,
  )
  if (preset) {
    const [whole, fraction = ''] = preset.bonusAmount.split('.')
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  }
  return config.customEnabled
    ? rechargeBonusCents(amount, config.bonusRules)
    : null
}
