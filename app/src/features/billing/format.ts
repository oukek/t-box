export const displayMoney = (value: string) =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
export const centsYuan = (value: number) =>
  displayMoney((value / 100).toFixed(2))
