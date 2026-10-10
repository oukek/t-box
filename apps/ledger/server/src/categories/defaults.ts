/** Seed templates only. Live categories are always read from the selected book. */
export const CATEGORY_SEEDS = [
  { label: '餐饮', type: 'expense', icon: 'food' },
  { label: '交通', type: 'expense', icon: 'transport' },
  { label: '购物', type: 'expense', icon: 'shopping' },
  { label: '居家', type: 'expense', icon: 'housing' },
  { label: '娱乐', type: 'expense', icon: 'entertainment' },
  { label: '医疗', type: 'expense', icon: 'health' },
  { label: '其他支出', type: 'expense', icon: 'other' },
  { label: '工资', type: 'income', icon: 'salary' },
  { label: '奖金', type: 'income', icon: 'bonus' },
  { label: '其他收入', type: 'income', icon: 'other' },
] as const
