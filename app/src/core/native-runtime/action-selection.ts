import type { ApplicationContext, InstalledApplicationAction } from '@t-box/app-contracts'

/** Shipped local UI may configure an installed action contract without gaining general cloud API access. */
export function selectShortcutAction(context: ApplicationContext, id: string, version: number, actions: readonly InstalledApplicationAction[]) {
  return actions.find((action) => action.appId === context.appId && action.id === id && action.version === version && action.background && (context.access === 'local' || (action.releaseId === context.releaseId && action.generation === context.generation)))
}
