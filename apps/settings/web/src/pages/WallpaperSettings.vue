<script setup lang="ts">
import type { DesktopWallpapers, WallpaperSource, WallpaperTarget } from '@t-box/app-contracts'
import { builtinWallpapers, builtinWallpaperUrl, defaultDesktopWallpapers } from '@t-box/app-contracts'
import { desktopAppearance, identity, refreshDesktopAppearance, releaseWallpaperPreviews, RequestError, saveDesktopWallpapers, uploadDesktopWallpaper } from '@t-box/app-shell-sdk'
import { AppIcon, BottomSheet } from '@t-box/ui-kit'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const targets: { value: WallpaperTarget, label: string }[] = [
  { value: 'common', label: '通用' },
  { value: 'mobile', label: '手机' },
  { value: 'tablet', label: '平板' },
  { value: 'pc', label: '电脑' },
]
const open = ref(false)
const target = ref<WallpaperTarget>('common')
const draft = ref<DesktopWallpapers>(defaultDesktopWallpapers())
const uploading = ref(false)
const error = ref('')
const picker = ref<HTMLInputElement>()
const busy = computed(() => desktopAppearance.loading || desktopAppearance.saving || uploading.value)
const cloneSaved = () => JSON.parse(JSON.stringify(desktopAppearance.wallpapers)) as DesktopWallpapers
const selected = computed(() => draft.value[target.value])
const effective = computed(() => selected.value ?? draft.value.common)
const changed = computed(() => JSON.stringify(draft.value) !== JSON.stringify(desktopAppearance.wallpapers))
function imageUrl(source: Readonly<WallpaperSource> | null) {
  return source?.kind === 'resource' ? desktopAppearance.imageUrls[source.resourceId] || '' : source ? builtinWallpaperUrl(source) : ''
}
const previewStyle = computed(() => ({ backgroundImage: `url(${JSON.stringify(imageUrl(effective.value))})` }))
const commonImage = computed(() => imageUrl(desktopAppearance.wallpapers.common))
async function show() {
  open.value = true
  target.value = 'common'
  error.value = ''
  draft.value = cloneSaved()
  await refreshDesktopAppearance()
  if (open.value) {
    draft.value = cloneSaved()
  }
}
function close() {
  if (busy.value) {
    return
  }
  open.value = false
  releaseWallpaperPreviews()
}
function select(source: WallpaperSource | null) {
  if (target.value === 'common') {
    draft.value.common = source ?? defaultDesktopWallpapers().common
  } else {
    draft.value[target.value] = source
  }
  error.value = ''
}
async function uploaded(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }
  uploading.value = true
  error.value = ''
  try {
    select(await uploadDesktopWallpaper(file))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '图片上传失败，请重试'
  } finally {
    uploading.value = false
  }
}
async function apply() {
  error.value = ''
  try {
    await saveDesktopWallpapers(draft.value)
    close()
  } catch (cause) {
    if (cause instanceof RequestError && cause.code === 'DESKTOP_APPEARANCE_CHANGED') {
      draft.value = cloneSaved()
    }
    error.value = cause instanceof Error ? cause.message : '壁纸保存失败，请重试'
  }
}
watch(() => identity.user?.id, () => {
  open.value = false
  draft.value = defaultDesktopWallpapers()
  error.value = ''
})
onBeforeUnmount(releaseWallpaperPreviews)
</script>

<template>
  <button class="wallpaper-entry" @click="show">
    <span
      class="wallpaper-entry-image"
      :style="{ backgroundImage: `url(${JSON.stringify(commonImage)})` }"
      aria-hidden="true"
    />
    <span><strong>桌面壁纸</strong><small>内置壁纸 · 自定义上传 · 多设备适配</small></span>
    <AppIcon name="right" :size="17" />
  </button>
  <BottomSheet
    :open="open"
    title="桌面壁纸"
    :busy="busy"
    full-height
    @close="close"
  >
    <div class="wallpaper-targets" aria-label="壁纸适用设备">
      <button
        v-for="item in targets"
        :key="item.value"
        :aria-pressed="target === item.value"
        :disabled="busy"
        @click="target = item.value"
      >{{ item.label }}</button>
    </div>
    <p class="wallpaper-note">{{ target === 'common' ? '一张壁纸适配所有设备，也可为手机、平板和电脑单独设置。' : '单独设置优先生效；选择跟随通用，则使用通用壁纸。' }}</p>
    <div
      class="wallpaper-preview-stage"
      :class="`wallpaper-preview--${target}`"
      aria-label="壁纸效果预览"
    >
      <div class="wallpaper-preview-screen" :style="previewStyle">
        <span class="wallpaper-preview-time" aria-hidden="true">10:08</span>
        <span class="wallpaper-preview-icons" aria-hidden="true"><i v-for="index in 6" :key="index" /></span>
      </div>
      <span class="wallpaper-preview-caption">{{ targets.find((item) => item.value === target)?.label }}效果预览 · 居中裁切</span>
    </div>
    <button
      v-if="target !== 'common'"
      class="wallpaper-follow"
      :aria-pressed="selected === null"
      :disabled="busy"
      @click="select(null)"
    >
      <AppIcon name="image" :size="18" />跟随通用壁纸<AppIcon
        v-if="selected === null"
        name="check"
        :size="17"
      />
    </button>
    <h3 class="wallpaper-section-title">内置壁纸</h3>
    <div class="wallpaper-choices" aria-label="选择内置壁纸">
      <button
        v-for="wallpaper in builtinWallpapers"
        :key="wallpaper.id"
        class="wallpaper-choice"
        :aria-pressed="selected?.kind === 'builtin' && selected.id === wallpaper.id"
        :disabled="busy"
        @click="select({ kind: 'builtin', id: wallpaper.id })"
      >
        <span class="wallpaper-choice-image"><img
          :src="wallpaper.url"
          alt=""
          loading="lazy"
        ><span v-if="selected?.kind === 'builtin' && selected.id === wallpaper.id" class="wallpaper-check"><AppIcon name="check" :size="14" /></span></span>
        <span>{{ wallpaper.name }}</span>
      </button>
    </div>
    <h3 class="wallpaper-section-title">自己的照片</h3>
    <button
      class="wallpaper-upload"
      :disabled="busy || !!desktopAppearance.error"
      @click="picker?.click()"
    >
      <img
        v-if="selected?.kind === 'resource' && imageUrl(selected)"
        :src="imageUrl(selected)"
        alt="已选自定义壁纸"
      >
      <AppIcon
        v-else
        name="image"
        :size="24"
      />
      <span><strong>{{ uploading ? '正在上传…' : selected?.kind === 'resource' ? '更换这张照片' : '上传图片' }}</strong><small>PNG、JPEG、WebP，单张不超过 10MB</small></span>
      <AppIcon name="plus" :size="18" />
    </button>
    <input
      ref="picker"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      aria-label="上传桌面壁纸"
      @change="uploaded"
    >
    <p class="wallpaper-note">上传图片保存在“我的资源”中；未点击“应用壁纸”不会改变桌面。移除或更换壁纸不会删除原图。</p>
    <p
      v-if="error || desktopAppearance.error"
      class="form-error"
      role="alert"
    >{{ error || desktopAppearance.error }}</p>
    <button
      v-if="desktopAppearance.error"
      class="button button-secondary"
      :disabled="busy"
      @click="show"
    >重新加载</button>
    <template #footer>
      <button
        class="button button-secondary"
        :disabled="busy"
        @click="draft = defaultDesktopWallpapers(); error = ''"
      >恢复默认</button>
      <button
        class="button button-primary"
        :disabled="busy || !!desktopAppearance.error || !changed"
        @click="apply"
      >{{ desktopAppearance.saving ? '正在应用…' : '应用壁纸' }}</button>
    </template>
  </BottomSheet>
</template>

<style scoped>
.wallpaper-entry {
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid #e7ecee;
  border-radius: 14px;
  color: var(--ink);
  background: #fff;
  text-align: left;
}
.wallpaper-entry-image {
  width: 39px;
  height: 49px;
  flex-shrink: 0;
  background: #173448 center / cover;
  border-radius: 8px;
}
.wallpaper-entry > span:nth-child(2),
.wallpaper-upload > span {
  flex: 1;
  min-width: 0;
}
.wallpaper-entry strong,
.wallpaper-upload strong {
  display: block;
  font-size: 13px;
  font-weight: 500;
}
.wallpaper-entry small,
.wallpaper-upload small {
  display: block;
  font-size: 10px;
  color: #84949c;
  margin-top: 6px;
  line-height: 1.6;
}
.wallpaper-entry > svg {
  color: #8b9ba4;
}
.wallpaper-targets {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  background: #f0f4f5;
  padding: 4px;
  border-radius: 11px;
}
.wallpaper-targets button {
  border: 0;
  border-radius: 8px;
  padding: 9px 3px;
  background: transparent;
  font-size: 12px;
  color: #7d8c96;
}
.wallpaper-targets button[aria-pressed='true'] {
  background: #fff;
  color: #315e56;
  box-shadow: 0 2px 5px #263f4a0a;
}
.wallpaper-note {
  font-size: 11px;
  color: #7d8e97;
  line-height: 1.8;
  margin: 12px 0;
}
.wallpaper-preview-stage {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 16px;
  background: #f4f6f8;
  border-radius: 14px;
}
.wallpaper-preview-screen {
  width: 108px;
  aspect-ratio: 9 / 16;
  border-radius: 13px;
  background: #173448 center / cover;
  color: #fff;
  padding: 24px 10px 10px;
  box-shadow: 0 4px 12px #102a3a12;
  position: relative;
  overflow: hidden;
}
.wallpaper-preview-screen::before {
  content: '';
  position: absolute;
  inset: 0;
  background: #06121f33;
}
.wallpaper-preview-time {
  position: relative;
  display: block;
  font-size: 23px;
  letter-spacing: -1px;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 4px #001325b3;
}
.wallpaper-preview-icons {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 7px;
  margin-top: 19px;
}
.wallpaper-preview-icons i {
  display: block;
  aspect-ratio: 1;
  border-radius: 4px;
  background: #ffffffb3;
}
.wallpaper-preview--tablet .wallpaper-preview-screen {
  width: 143px;
  aspect-ratio: 3 / 4;
}
.wallpaper-preview--pc .wallpaper-preview-screen {
  width: min(100%, 340px);
  aspect-ratio: 16 / 10;
}
.wallpaper-preview--pc .wallpaper-preview-icons {
  grid-template-columns: repeat(8, 17px);
}
.wallpaper-preview-caption {
  font-size: 10px;
  color: #8899a4;
}
.wallpaper-follow {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 13px 12px;
  border-radius: 10px;
  border: 1px solid #e4e9ed;
  background: #fff;
  color: #657d87;
  font-size: 12px;
  margin-top: 14px;
}
.wallpaper-follow[aria-pressed='true'] {
  background: #edf6f2;
  border-color: #6da698;
  color: #327b6d;
}
.wallpaper-follow > svg:last-child:not(:first-child) {
  margin-left: auto;
}
.wallpaper-section-title {
  margin: 22px 0 12px;
  font-size: 12px;
  font-weight: 500;
  color: #607580;
}
.wallpaper-choices {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.wallpaper-choice {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  font-size: 11px;
  color: #738692;
}
.wallpaper-choice-image {
  display: block;
  position: relative;
  overflow: hidden;
  aspect-ratio: 3 / 4;
  border-radius: 11px;
  margin-bottom: 8px;
  background: #173448;
  border: 2px solid transparent;
}
.wallpaper-choice img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.wallpaper-choice[aria-pressed='true'] .wallpaper-choice-image {
  border-color: #398a78;
}
.wallpaper-choice[aria-pressed='true'] {
  color: #327b6d;
}
.wallpaper-check {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background: #398a78;
  color: #fff;
}
.wallpaper-upload {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px;
  border: 1px dashed #cbd9de;
  border-radius: 12px;
  background: #fafcfc;
  text-align: left;
  color: #6d8792;
}
.wallpaper-upload > img {
  width: 39px;
  height: 49px;
  object-fit: cover;
  border-radius: 7px;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
button:focus-visible {
  outline: 2px solid #398a78;
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  * {
    scroll-behavior: auto;
  }
}
</style>
