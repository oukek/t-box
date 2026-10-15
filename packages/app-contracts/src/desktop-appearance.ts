/** Shared by the settings picker, desktop grid and drag preview. */
export const desktopIconSizes = {
  small: { label: '小', description: '紧凑', pixels: 44 },
  medium: { label: '中', description: '标准', pixels: 56 },
  large: { label: '大', description: '醒目', pixels: 68 },
} as const
export type DesktopIconSize = keyof typeof desktopIconSizes
export const iconSizeOptions = Object.entries(desktopIconSizes).map(
  ([value, option]) => ({
    value: value as DesktopIconSize,
    ...option,
  }),
)
export function isDesktopIconSize(value: unknown): value is DesktopIconSize {
  return typeof value === 'string' && Object.hasOwn(desktopIconSizes, value)
}
