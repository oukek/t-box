/** A host-owned phone viewport; apps keep their normal mobile layout at every window size. */
export const applicationPhone = { width: 390, height: 844, toolbar: 44 } as const
export interface WindowViewport { width: number, height: number, left: number, top: number }
export interface WindowPosition { x: number, y: number }
export interface WindowSize { width: number, height: number }
export function applicationWindowSize(viewport: WindowViewport, expanded: boolean): WindowSize {
  const margin = viewport.width < 768 ? 8 : 16
  // Leave room for the chat composer on phones; expanding is an explicit user choice.
  const maximumHeight = !expanded && viewport.width < 768 ? Math.min(viewport.height - margin * 2, viewport.height * 0.61) : viewport.height - margin * 2
  const availableHeight = Math.max(1, maximumHeight - applicationPhone.toolbar)
  const preferred = expanded ? 390 : viewport.width < 768 ? Math.min(240, viewport.width * 0.62) : 320
  const width = Math.max(1, Math.min(preferred, viewport.width - margin * 2, availableHeight * applicationPhone.width / applicationPhone.height))
  return { width, height: width * applicationPhone.height / applicationPhone.width + applicationPhone.toolbar }
}
export function constrainApplicationWindow(position: WindowPosition, size: WindowSize, viewport: WindowViewport): WindowPosition {
  const margin = viewport.width < 768 ? 8 : 16
  const left = viewport.left + Math.min(margin, Math.max(0, (viewport.width - size.width) / 2))
  const top = viewport.top + Math.min(margin, Math.max(0, (viewport.height - size.height) / 2))
  return {
    x: Math.min(Math.max(left, position.x), Math.max(left, viewport.left + viewport.width - size.width - margin)),
    y: Math.min(Math.max(top, position.y), Math.max(top, viewport.top + viewport.height - size.height - margin)),
  }
}
export function initialApplicationWindow(size: WindowSize, viewport: WindowViewport): WindowPosition {
  return constrainApplicationWindow({ x: viewport.left + viewport.width - size.width - 24, y: viewport.top + 72 }, size, viewport)
}
