<script setup lang="ts">
import type {
  CreativeProject,
  CreativeProjectInput,
} from '@t-box/baby-diary-contracts'
import type { ProjectDetail } from './runtime'
import {
  creativeTemplates,
  defaultPlayback,
} from '@t-box/baby-diary-contracts'
import { Modal, SheetSelect } from '@t-box/ui-kit'
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import BabyDoodle from './BabyDoodle.vue'
import ProjectEditor from './ProjectEditor.vue'
import {
  base,
  canEdit,
  errorText,
  invoke,
  manager,
  onPrivateClear,
  refreshBaby,
  writable,
} from './runtime'

const props = defineProps<{ revision: number }>()
const projects = ref<CreativeProject[]>([])
const detail = ref<ProjectDetail>()
const error = ref('')
const busy = ref(false)
const creating = ref(false)
const trash = ref(false)
const removing = ref<CreativeProject>()
const draft = reactive<CreativeProjectInput>({
  title: '',
  template: 'daily-photo',
  visibility: 'members',
  settings: { ...defaultPlayback },
})
let version = 0
async function load() {
  const current = ++version
  try {
    const result = await invoke<CreativeProject[]>('projects_list', {
      ...base(),
      trash: trash.value,
    })
    if (current === version) {
      projects.value = result
    }
  } catch (e) {
    if (current === version) {
      projects.value = []
      error.value = errorText(e)
    }
  }
}
async function open(project: CreativeProject) {
  busy.value = true
  error.value = ''
  const current = version
  try {
    const result = await invoke<ProjectDetail>('projects_get', {
      ...base(),
      projectId: project.id,
    })
    if (current === version) {
      detail.value = result
    }
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
async function create() {
  busy.value = true
  error.value = ''
  try {
    const project = await invoke<CreativeProject>('projects_create', {
      ...base(),
      project: { ...draft, settings: { ...draft.settings } },
    })
    creating.value = false
    await saved()
    await open(project)
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
async function saved() {
  detail.value = undefined
  await refreshBaby()
  await load()
}
async function remove() {
  if (!removing.value) {
    return
  }
  busy.value = true
  try {
    await invoke('projects_delete', {
      ...base(),
      projectId: removing.value.id,
      revision: removing.value.revision,
    })
    removing.value = undefined
    await saved()
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
watch(trash, () => {
  void load()
})
async function restore(project: CreativeProject) {
  busy.value = true
  try {
    await invoke('projects_restore', {
      ...base(),
      projectId: project.id,
      revision: project.revision,
    })
    await saved()
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
watch(
  () => props.revision,
  () => {
    void load()
  },
)
onMounted(() => {
  void load()
})
const stop = onPrivateClear(() => {
  version++
  projects.value = []
  detail.value = undefined
  creating.value = false
})
onBeforeUnmount(() => {
  version++
  stop()
})
</script>

<template>
  <section aria-label="创意影像">
    <div class="section-heading">
      <div>
        <h2>把时光，连成一段</h2>
        <p class="subtle">相同的姿势，不同的每一天。</p>
      </div>
      <button
        v-if="writable"
        class="primary small"
        @click="
          draft.title = '';
          creating = true;
        "
      >
        ＋ 新项目
      </button>
    </div>
    <button
      v-if="manager"
      class="text-button muted"
      @click="trash = !trash"
    >
      {{ trash ? "返回创意项目" : "项目回收站" }}
    </button>
    <p
      v-if="error && !creating"
      class="error"
      role="alert"
    >{{ error }}</p>
    <div v-if="trash && !projects.length" class="empty-state">
      <h3>项目回收站是空的</h3>
    </div>
    <div v-else-if="!projects.length" class="creative-intro">
      <BabyDoodle scene="photos" />
      <h3>看见悄悄长大的模样</h3>
      <p>
        每天一张、每月留影、和玩偶一起长大……<br>对齐照片，选择速度，在设备上播放成长动画。
      </p>
      <button
        v-if="writable"
        class="primary"
        @click="creating = true"
      >
        创建第一个项目
      </button>
    </div>
    <div v-else class="project-list">
      <article
        v-for="project in projects"
        :key="project.id"
        class="project-card"
      >
        <button
          class="project-open"
          :disabled="busy || trash"
          @click="open(project)"
        >
          <span class="project-art" aria-hidden="true">▤</span><span><strong>{{ project.title }}</strong><small>{{
            creativeTemplates.find((row) => row.id === project.template)
              ?.title
          }}
            · {{ project.frameCount }} 张照片</small><small v-if="project.visibility === 'managers'">仅管理者</small></span><span class="play-arrow" aria-hidden="true">▷</span></button><button
          v-if="!trash && canEdit(project.author)"
          class="text-button muted project-delete"
          @click="removing = project"
        >
          删除
        </button>
        <button
          v-if="trash"
          class="text-button project-delete"
          :disabled="busy"
          @click="restore(project)"
        >
          恢复项目
        </button>
      </article>
    </div>
    <div class="template-notes">
      <h3>更多记录灵感</h3>
      <div v-for="template in creativeTemplates" :key="template.id">
        <strong>{{ template.title }}</strong><small>{{ template.description }}</small>
      </div>
    </div>
  </section>
  <Modal
    :open="creating"
    title="新的创意项目"
    :busy="busy"
    @close="creating = false"
  ><form
     id="baby-project-form"
     class="form-stack"
     @submit.prevent="create"
   >
     <label>项目名称<input
       v-model="draft.title"
       maxlength="60"
       placeholder="例如：小满的每一天"
       required
     ></label><label>记录灵感<SheetSelect
       v-model="draft.template"
       label="记录灵感"
       :options="
         creativeTemplates.map((row) => ({
           value: row.id,
           label: row.title,
           description: row.description,
         }))
       "
     /></label><label v-if="manager">可见范围<SheetSelect
       v-model="draft.visibility"
       label="项目可见范围"
       :options="[
         { value: 'members', label: '授权成员' },
         { value: 'managers', label: '仅管理者' },
       ]"
     /></label>
     <p
       v-if="error"
       class="error"
       role="alert"
     >{{ error }}</p>
   </form>
    <template #footer><button
      class="primary"
      form="baby-project-form"
      :disabled="busy"
    >
      创建并加照片
    </button></template></Modal>
  <ProjectEditor
    v-if="detail"
    :detail="detail"
    :editable="canEdit(detail.project.author)"
    @close="detail = undefined"
    @saved="saved"
  />
  <Modal
    :open="!!removing"
    title="删除创意项目？"
    :busy="busy"
    @close="removing = undefined"
  ><p>项目会移入回收站，照片与对齐设置会保留，管理者可以恢复。</p>
    <template #footer><button class="secondary" @click="removing = undefined">取消</button><button
      class="danger"
      :disabled="busy"
      @click="remove"
    >
      删除项目
    </button></template></Modal>
</template>
