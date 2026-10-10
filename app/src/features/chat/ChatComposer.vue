<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import {
  CHAT_LIMITS,
  type ApplicationId,
  type ChatMode,
  type Resource,
} from "@t-box/shared";
import { AppIcon } from "@t-box/ui-kit";
import ResourceImage from "../../components/ResourceImage.vue";
import { getApplication, aiApplications } from "../../core/applications";
import { mentionAt, mentionCandidates, type MentionQuery } from "./mentions";
const props = defineProps<{
  maxMessageLength?: number;
  modelValue: string;
  applicationIds: ApplicationId[];
  attachments: Resource[];
  canSend: boolean;
  busy: boolean;
  canStop: boolean;
  cancelling: boolean;
  uploading: boolean;
  mode: ChatMode | null;
}>();
const emit = defineEmits<{
  "update:modelValue": [text: string];
  "update:applicationIds": [ids: ApplicationId[]];
  send: [];
  stop: [];
  files: [files: File[]];
  removeAttachment: [id: string];
}>();
const input = ref<HTMLTextAreaElement>(),
  fileInput = ref<HTMLInputElement>(),
  root = ref<HTMLElement>();
const menu = ref<"applications" | "add" | null>(null),
  mention = ref<MentionQuery | null>(null),
  active = ref(0),
  dragging = ref(false);
const listId = useId(),
  inputId = useId();
const candidates = computed(() =>
  mentionCandidates(mention.value?.query || "", aiApplications.value),
);
const selected = computed(() =>
  props.applicationIds.map(getApplication).filter((app) => !!app),
);
const mobile = ref(false);
let media: MediaQueryList | undefined;
function updateMedia() {
  mobile.value = !!media?.matches;
}
function resize() {
  void nextTick(() => {
    if (input.value) {
      input.value.style.height = "auto";
      input.value.style.height = `${Math.min(mobile.value ? 130 : 190, input.value.scrollHeight)}px`;
    }
  });
}
function queryMention() {
  if (!input.value) return;
  mention.value = mentionAt(input.value.value, input.value.selectionStart);
  menu.value = mention.value ? "applications" : null;
  active.value = 0;
}
function update(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  emit("update:modelValue", target.value);
  queryMention();
  resize();
}
function closeMenus() {
  menu.value = null;
  mention.value = null;
}
function selectApp(id: ApplicationId) {
  if (!props.applicationIds.includes(id))
    emit("update:applicationIds", [...props.applicationIds, id]);
  const replacement = mention.value;
  if (replacement)
    emit(
      "update:modelValue",
      props.modelValue.slice(0, replacement.start) +
        props.modelValue.slice(replacement.end),
    );
  closeMenus();
  void nextTick(() => {
    input.value?.focus();
    if (replacement)
      input.value?.setSelectionRange(replacement.start, replacement.start);
    resize();
  });
}
function removeApp(id: ApplicationId) {
  emit(
    "update:applicationIds",
    props.applicationIds.filter((value) => value !== id),
  );
  input.value?.focus();
}
function openApplications() {
  mention.value = null;
  menu.value = menu.value === "applications" ? null : "applications";
  active.value = 0;
}
function send() {
  if (
    props.canSend &&
    !props.uploading &&
    (props.modelValue.trim() || props.attachments.length)
  ) {
    closeMenus();
    emit("send");
  }
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (menu.value === "applications") {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenus();
      return;
    }
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (candidates.value.length)
        active.value =
          (active.value +
            (event.key === "ArrowDown" ? 1 : candidates.value.length - 1)) %
          candidates.value.length;
      return;
    }
    if (event.key === "Enter" && candidates.value.length) {
      event.preventDefault();
      selectApp(candidates.value[active.value]!.id);
      return;
    }
  }
  if (event.key === "Enter" && !event.shiftKey && !mobile.value) {
    event.preventDefault();
    send();
  }
}
function chooseFiles(event: Event) {
  const target = event.target as HTMLInputElement;
  emit("files", [...(target.files || [])]);
  target.value = "";
  closeMenus();
}
function pick() {
  closeMenus();
  fileInput.value?.click();
}
function paste(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.files || [])];
  if (files.length && !props.busy && !props.uploading) {
    event.preventDefault();
    emit("files", files);
  }
}
function drop(event: DragEvent) {
  dragging.value = false;
  if (!props.busy && !props.uploading && event.dataTransfer?.files.length)
    emit("files", [...event.dataTransfer.files]);
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) closeMenus();
}
onMounted(() => {
  media = window.matchMedia("(pointer: coarse), (max-width: 700px)");
  updateMedia();
  media.addEventListener("change", updateMedia);
  document.addEventListener("pointerdown", outside);
  resize();
});
onBeforeUnmount(() => {
  media?.removeEventListener("change", updateMedia);
  document.removeEventListener("pointerdown", outside);
});
watch(
  () => props.modelValue,
  (value) => {
    resize();
    if (!value) closeMenus();
  },
);
watch(
  () => props.busy,
  (busy) => {
    if (busy) closeMenus();
  },
);
defineExpose({ focus: () => input.value?.focus(), closeMenus });
</script>
<template>
  <form
    ref="root"
    class="conversation-composer"
    :class="{ dragging }"
    @submit.prevent="send"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="drop"
  >
    <div v-if="attachments.length" class="draft-attachments">
      <div
        v-for="resource in attachments"
        :key="resource.id"
        class="draft-attachment"
      >
        <ResourceImage
          v-if="resource.mimeType.startsWith('image/')"
          :resource="resource"
        /><AppIcon v-else name="file" :size="23" /><span
          :title="resource.name"
          >{{ resource.name }}</span
        ><button
          type="button"
          :aria-label="`移除 ${resource.name}`"
          @click="emit('removeAttachment', resource.id)"
        >
          <AppIcon name="close" :size="13" />
        </button>
      </div>
    </div>
    <div v-if="selected.length" class="composer-app-tags">
      <span v-for="app in selected" :key="app.id" class="composer-app-tag"
        ><AppIcon :name="app.icon" :size="14" />@{{ app.name
        }}<button
          type="button"
          :aria-label="`移除应用 ${app.name}`"
          @click="removeApp(app.id)"
        >
          <AppIcon name="close" :size="12" /></button
      ></span>
    </div>
    <label class="sr-only" :for="inputId">发给 T Box 的消息</label
    ><textarea
      :id="inputId"
      ref="input"
      :value="modelValue"
      rows="2"
      :maxlength="maxMessageLength ?? CHAT_LIMITS.maxMessageLength"
      placeholder="发送消息，输入 @ 选择应用…"
      :aria-controls="menu === 'applications' ? listId : undefined"
      :aria-expanded="menu === 'applications'"
      :aria-activedescendant="
        menu === 'applications' && candidates.length
          ? `${listId}-${active}`
          : undefined
      "
      @input="update"
      @click="queryMention"
      @keyup.left="queryMention"
      @keyup.right="queryMention"
      @compositionend="queryMention"
      @keydown="keydown"
      @paste="paste"
    ></textarea>
    <div
      v-if="menu === 'applications'"
      :id="listId"
      class="composer-popover app-mention-menu"
      role="listbox"
      aria-label="选择应用"
    >
      <div class="composer-popover-heading">
        选择应用<span>仅添加到当前消息</span>
      </div>
      <button
        v-for="(app, index) in candidates"
        :id="`${listId}-${index}`"
        :key="app.id"
        type="button"
        class="app-mention-option"
        :class="{ highlighted: active === index }"
        role="option"
        :aria-selected="applicationIds.includes(app.id)"
        @pointerdown.prevent
        @click="selectApp(app.id)"
      >
        <span class="mention-app-icon"
          ><AppIcon :name="app.icon" :size="20" /></span
        ><span
          ><strong>{{ app.name }}</strong
          ><small>{{ app.description }}</small></span
        ><AppIcon
          v-if="applicationIds.includes(app.id)"
          name="check"
          :size="16"
        />
      </button>
      <p v-if="!candidates.length" class="mention-empty">没有匹配的应用</p>
    </div>
    <div v-if="menu === 'add'" class="composer-popover composer-add-menu">
      <div class="composer-popover-heading">添加到消息</div>
      <button type="button" :disabled="uploading || busy" @click="pick">
        <AppIcon name="image" :size="19" /><span
          >图片或文件<small>支持上传、粘贴和拖入</small></span
        ></button
      ><button
        type="button"
        @click="
          menu = 'applications';
          mention = null;
        "
      >
        <AppIcon name="apps" :size="19" /><span
          >选择应用<small>告诉 AI 这次想使用哪个应用</small></span
        >
      </button>
    </div>
    <div class="composer-tools">
      <div class="composer-tools-left">
        <button
          type="button"
          class="composer-tool"
          aria-label="添加到消息"
          :aria-expanded="menu === 'add'"
          :disabled="busy"
          @click="
            mention = null;
            menu = menu === 'add' ? null : 'add';
          "
        >
          <AppIcon name="plus" :size="21" /></button
        ><button
          type="button"
          class="composer-tool"
          :aria-label="uploading ? '正在上传附件' : '添加图片或文件'"
          :disabled="uploading || busy"
          @click="pick"
        >
          <span v-if="uploading" class="spinner small"></span
          ><AppIcon v-else name="image" :size="19" /></button
        ><button
          type="button"
          class="composer-app-picker"
          aria-label="选择应用"
          :aria-expanded="menu === 'applications'"
          :disabled="busy"
          @click="openApplications"
        >
          <span>@</span>应用
        </button>
      </div>
      <div class="composer-tools-right">
        <span
          class="composer-model-status"
          :class="{ unconfigured: mode === 'unconfigured' }"
          >{{
            mode === "openai"
              ? "AI 对话"
              : mode === "unconfigured"
                ? "未接入 AI"
                : "连接中…"
          }}</span
        ><button
          v-if="busy && canStop"
          type="button"
          class="composer-send stop"
          :disabled="cancelling"
          :aria-label="cancelling ? '正在停止' : '停止处理'"
          @click="emit('stop')"
        >
          <AppIcon name="stop" :size="17" /></button
        ><button
          v-else
          type="submit"
          class="composer-send"
          aria-label="发送消息"
          :disabled="
            !canSend || uploading || (!modelValue.trim() && !attachments.length)
          "
        >
          <span v-if="busy" class="spinner small"></span
          ><AppIcon v-else name="send" :size="20" />
        </button>
      </div>
    </div>
    <input
      ref="fileInput"
      class="sr-only"
      type="file"
      accept="image/png,image/jpeg,image/webp,.pdf,.txt,.md"
      multiple
      tabindex="-1"
      aria-label="选择会话附件"
      @change="chooseFiles"
    />
  </form>
</template>
