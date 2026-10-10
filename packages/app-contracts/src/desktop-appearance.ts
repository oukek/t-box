/** Shared by the settings picker, desktop grid and drag preview. */
export const desktopIconSizes = {
  small: { label: "小", columns: 6, pc: 64, mobile: 42 },
  medium: { label: "中", columns: 5, pc: 76, mobile: 50 },
  large: { label: "大", columns: 4, pc: 88, mobile: 62 },
} as const;
export type DesktopIconSize = keyof typeof desktopIconSizes;
export const iconSizeOptions = Object.entries(desktopIconSizes).map(
  ([value, option]) => ({
    value: value as DesktopIconSize,
    ...option,
  }),
);
export function isDesktopIconSize(value: unknown): value is DesktopIconSize {
  return typeof value === "string" && Object.hasOwn(desktopIconSizes, value);
}
