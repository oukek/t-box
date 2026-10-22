import type { BabyInput, BabyProfile } from '@t-box/baby-diary-contracts'
import { resolveBabyTheme } from '@t-box/baby-diary-contracts'
import { onBeforeUnmount, shallowRef, watchEffect } from 'vue'

const preview = shallowRef<(Pick<BabyInput, 'sex' | 'theme'> & { owner: symbol })>()

/** A root theme reaches teleported sheets and SVG charts inside this app's iframe. */
export function useBabyTheme(profile: () => BabyProfile | undefined) {
  watchEffect(() => {
    const value = preview.value ?? profile()
    document.documentElement.dataset.babyTheme = resolveBabyTheme(value?.sex ?? 'unknown', value?.theme)
  })
  onBeforeUnmount(() => {
    delete document.documentElement.dataset.babyTheme
  })
}

/** Draft colors never write to the backend, and cancellation restores the saved profile. */
export function useBabyThemePreview(draft: BabyInput) {
  const owner = Symbol('baby-theme-preview')
  watchEffect(() => {
    preview.value = { owner, sex: draft.sex, theme: draft.theme }
  })
  onBeforeUnmount(() => {
    if (preview.value?.owner === owner) {
      preview.value = undefined
    }
  })
}
