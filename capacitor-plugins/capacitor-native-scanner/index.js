import { registerPlugin } from '@capacitor/core'

export const NativeScanner = registerPlugin('NativeScanner', {
  web: () => import('./web.js').then((module) => new module.NativeScannerWeb()),
})
