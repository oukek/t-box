<script setup lang="ts">
import type {
  CreativeFrame,
  CreativeProject,
  CreativeProjectInput,
} from '@t-box/baby-diary-contracts'
import type { ProjectDetail } from './runtime'
import { parseFrames, parseProject } from '@t-box/baby-diary-contracts'
import { frameTransform } from '@t-box/baby-diary-core'
import { BottomSheet, Modal, SheetSelect } from '@t-box/ui-kit'
import DateField from '@t-box/ui-kit/DateSheetField.vue'
import { computed, onBeforeUnmount, ref } from 'vue'
import CreativePlayer from './CreativePlayer.vue'
import MediaThumb from './MediaThumb.vue'
import {
  base,
  errorText,
  host,
  invoke,
  onPrivateClear,
  scope,
  today,
} from './runtime'

const props = defineProps<{ detail: ProjectDetail, editable: boolean }>()
const emit = defineEmits<{ close: [], saved: [project: CreativeProject] }>()
const draft = ref<CreativeProjectInput>({
  title: props.detail.project.title,
  template: props.detail.project.template,
  visibility: props.detail.project.visibility,
  settings: { ...props.detail.project.settings },
})
const frames = ref<CreativeFrame[]>(
  props.detail.frames.map((frame) => ({ ...frame })),
)
const index = ref(0)
const frameStart = computed(() => Math.max(0, index.value - 3))
const visibleFrames = computed(() =>
  frames.value.slice(frameStart.value, frameStart.value + 7),
)
const playback = ref(!props.editable)
const busy = ref(false)
const error = ref('')
const reference = ref(false)
const confirmClose = ref(false)
const initial = JSON.stringify({ draft: draft.value, frames: frames.value })
const current = computed(() => frames.value[index.value])
const previous = computed(() => frames.value[index.value - 1])
const stop = onPrivateClear(() => {
  frames.value = []
  emit('close')
})
onBeforeUnmount(stop)
function close() {
  if (
    props.editable &&
    JSON.stringify({ draft: draft.value, frames: frames.value }) !== initial
  ) {
    confirmClose.value = true
  } else {
    emit('close')
  }
}
async function pick() {
  busy.value = true
  error.value = ''
  try {
    const assets = await host().files.private.pick(
      scope('creative', draft.value.visibility),
      { accept: 'image/*', multiple: true },
    )
    if (frames.value.length + assets.length > 1000) {
      error.value = '每个项目最多 1000 张照片'
      return
    }
    if (assets.some((file) => !file.mimeType.startsWith('image/'))) {
      error.value = '创意动画仅支持照片'
      return
    }
    const start = frames.value.length
    frames.value.push(
      ...assets.map((file) => ({
        id: crypto.randomUUID(),
        assetId: file.id,
        date: today(),
        caption: '',
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
      })),
    )
    if (assets.length) {
      index.value = start
    }
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
function move(offset: number) {
  const next = index.value + offset
  if (!current.value || next < 0 || next >= frames.value.length) {
    return
  }
  const [frame] = frames.value.splice(index.value, 1)
  frames.value.splice(next, 0, frame)
  index.value = next
}
function remove() {
  frames.value.splice(index.value, 1)
  index.value = Math.max(0, Math.min(index.value, frames.value.length - 1))
}
async function save() {
  busy.value = true
  error.value = ''
  try {
    const project = await invoke<CreativeProject>('projects_save', {
      ...base(),
      projectId: props.detail.project.id,
      revision: props.detail.project.revision,
      project: parseProject(draft.value),
      frames: parseFrames(frames.value),
    })
    emit('saved', project)
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BottomSheet
    open
    full-height
    :title="detail.project.title"
    :busy="busy"
    @close="close"
  >
    <div class="project-editor">
      <div v-if="editable" class="segmented">
        <button :class="{ selected: !playback }" @click="playback = false">
          照片与对齐</button><button :class="{ selected: playback }" @click="playback = true">
          动画预览
        </button>
      </div>
      <CreativePlayer
        v-if="playback"
        :frames="frames"
        :settings="draft.settings"
      />
      <template v-else>
        <div
          v-if="current"
          class="alignment-canvas"
          :style="{
            aspectRatio: draft.settings.aspect.replace(':', '/'),
            width: `min(100%, 340px, ${(47 * Number(draft.settings.aspect.split(':')[0])) / Number(draft.settings.aspect.split(':')[1])}dvh)`,
          }"
        >
          <div :style="{ transform: frameTransform(current) }">
            <MediaThumb :id="current.assetId" />
          </div>
          <div
            v-if="reference && previous"
            class="reference-photo"
            :style="{ transform: frameTransform(previous) }"
          >
            <MediaThumb :id="previous.assetId" alt="上一张照片的对齐参考" />
          </div>
          <span class="alignment-grid" aria-hidden="true" />
        </div>
        <div v-else class="empty-state compact">
          <h3>从第一张照片开始</h3>
          <p>站在相同的位置，保持相似的姿势，会更容易看见变化。</p>
        </div>
        <div class="frame-strip">
          <button
            v-for="(frame, i) in visibleFrames"
            :key="frame.id"
            :class="{ selected: index === i + frameStart }"
            :aria-label="`编辑第${i + frameStart + 1}张，${frame.date}`"
            @click="index = i + frameStart"
          >
            <MediaThumb :id="frame.assetId" /><small>{{
              i + frameStart + 1
            }}</small></button><button
            class="add-frame"
            :disabled="busy"
            @click="pick"
          >
            <span>＋</span><small>加照片</small>
          </button>
        </div>
        <label
          v-if="frames.length > 7"
          class="speed-control"
        >跳到第几张<input
          :value="index + 1"
          type="number"
          min="1"
          :max="frames.length"
          @change="
            index = Math.max(
              0,
              Math.min(
                frames.length - 1,
                Number(($event.target as HTMLInputElement).value) - 1,
              ),
            )
          "
        ></label>
        <div v-if="current" class="form-stack">
          <div class="section-heading">
            <h3>第 {{ index + 1 }} 张 · {{ frames.length }} 张</h3>
            <div class="inline-actions">
              <button
                class="text-button"
                :disabled="index === 0"
                @click="move(-1)"
              >
                前移</button><button
                class="text-button"
                :disabled="index === frames.length - 1"
                @click="move(1)"
              >
                后移</button><button class="text-button muted" @click="remove">移除</button>
            </div>
          </div>
          <div class="two-columns">
            <label>照片日期<DateField
              v-model="current.date"
              label="照片日期"
              :max="today()"
            /></label><label>照片说明<input
              v-model="current.caption"
              maxlength="200"
              placeholder="这天的小变化"
            ></label>
          </div>
          <label
            v-if="previous"
            class="check-row"
          ><input
            v-model="reference"
            type="checkbox"
          >叠加上一张作为对齐参考</label>
          <div class="two-columns">
            <label>左右位置 {{ current.x }}%<input
              v-model.number="current.x"
              type="range"
              min="-50"
              max="50"
              step="1"
            ></label><label>上下位置 {{ current.y }}%<input
              v-model.number="current.y"
              type="range"
              min="-50"
              max="50"
              step="1"
            ></label><label>缩放 {{ current.scale }}×<input
              v-model.number="current.scale"
              type="range"
              min="1"
              max="3"
              step=".01"
            ></label><label>旋转 {{ current.rotation }}°<input
              v-model.number="current.rotation"
              type="range"
              min="-20"
              max="20"
              step=".5"
            ></label>
          </div>
          <button
            class="text-button"
            @click="
              Object.assign(current, { x: 0, y: 0, scale: 1, rotation: 0 })
            "
          >
            还原对齐
          </button>
        </div>
      </template>
      <details
        v-if="editable"
        class="project-settings"
        open
      >
        <summary>项目与播放设置</summary>
        <div class="form-stack">
          <label>项目名称<input
            v-model="draft.title"
            maxlength="60"
            required
          ></label>
          <div class="two-columns">
            <label>变化方式<SheetSelect
              v-model="draft.settings.transition"
              label="变化方式"
              :options="[
                { value: 'cut', label: '直接切换' },
                { value: 'fade', label: '淡入淡出' },
                { value: 'slide', label: '横向滑动' },
                { value: 'zoom', label: '缓缓放大' },
              ]"
            /></label><label>画面比例<SheetSelect
              v-model="draft.settings.aspect"
              label="画面比例"
              :options="
                ['3:4', '1:1', '16:9'].map((value) => ({
                  value,
                  label: value,
                }))
              "
            /></label><label>每张停留 · 秒<input
              :value="draft.settings.frameMs / 1000"
              type="number"
              min=".04"
              max="10"
              step=".01"
              @input="
                draft.settings.frameMs = Math.round(
                  Number(($event.target as HTMLInputElement).value) * 1000,
                );
                draft.settings.transitionMs = Math.min(
                  draft.settings.transitionMs,
                  draft.settings.frameMs,
                );
              "
            ></label><label>转场时长 · 毫秒<input
              v-model.number="draft.settings.transitionMs"
              type="number"
              min="0"
              :max="draft.settings.frameMs"
              step="10"
            ></label>
          </div>
          <label>画面文字<SheetSelect
            v-model="draft.settings.overlay"
            label="画面文字"
            :options="[
              { value: 'age', label: '宝宝月龄' },
              { value: 'date', label: '拍摄日期' },
              { value: 'none', label: '不显示' },
            ]"
          /></label>
          <div class="two-columns">
            <label class="check-row"><input
              v-model="draft.settings.loop"
              type="checkbox"
            >循环播放</label><label class="check-row"><input
              v-model="draft.settings.reverse"
              type="checkbox"
            >倒序播放</label>
          </div>
        </div>
      </details>
      <p
        v-if="error"
        class="error"
        role="alert"
      >{{ error }}</p>
    </div>
    <template #footer><button
      v-if="editable"
      class="primary full"
      :disabled="busy"
      @click="save"
    >
      {{ busy ? "处理中…" : "保存成长项目" }}</button><button
      v-else
      class="secondary full"
      @click="emit('close')"
    >
      关闭播放
    </button></template>
  </BottomSheet>
  <Modal
    :open="confirmClose"
    title="放弃本次修改？"
    @close="confirmClose = false"
  ><p>尚未保存的照片排序、日期和对齐设置会丢失。</p>
    <template #footer><button class="secondary" @click="confirmClose = false">继续编辑</button><button class="danger" @click="emit('close')">放弃修改</button></template></Modal>
</template>
