export interface Viewport { width: number, height: number }
export interface Point { x: number, y: number }
export interface WindowRect extends Point { width: number, height: number }
export interface DockPosition { side: 'left' | 'right', ratio: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))
export const canFloatAssistant = ({ width, height }: Viewport) => width >= 900 && height >= 540

export function constrainAssistant(rect: WindowRect, viewport: Viewport): WindowRect {
  const width = clamp(rect.width, Math.min(360, viewport.width - 24), viewport.width - 24)
  const height = clamp(rect.height, Math.min(400, viewport.height - 24), viewport.height - 24)
  return { width, height, x: clamp(rect.x, 12, viewport.width - width - 12), y: clamp(rect.y, 12, viewport.height - height - 12) }
}
export function initialAssistant(viewport: Viewport): WindowRect {
  const width = Math.min(500, viewport.width * 0.46)
  return constrainAssistant({ x: viewport.width - width - 24, y: 72, width, height: Math.min(680, viewport.height - 96) }, viewport)
}
export function launcherPoint(dock: DockPosition, viewport: Viewport): Point {
  return { x: dock.side === 'left' ? 8 : Math.max(8, viewport.width - 64), y: 64 + clamp(dock.ratio, 0, 1) * Math.max(0, viewport.height - 152) }
}
export function dockLauncher(point: Point, viewport: Viewport): DockPosition {
  return { side: point.x + 28 < viewport.width / 2 ? 'left' : 'right', ratio: clamp((point.y - 64) / Math.max(1, viewport.height - 152), 0, 1) }
}
export function readAssistantLayout(value: string | null): { dock?: DockPosition, rect?: WindowRect, introduced?: boolean } {
  try {
    const data = JSON.parse(value || '{}')
    if (!data || typeof data !== 'object') {
      return {}
    }
    const dock = ['left', 'right'].includes(data.dock?.side) && Number.isFinite(data.dock?.ratio)
      ? { side: data.dock.side as DockPosition['side'], ratio: clamp(data.dock.ratio, 0, 1) }
      : undefined
    const rect = data.rect && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(data.rect[key])) && data.rect.width > 0 && data.rect.height > 0 ? data.rect as WindowRect : undefined
    return { dock, rect, introduced: data.introduced === true }
  } catch {
    return {}
  }
}
