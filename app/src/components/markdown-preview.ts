import { defineAsyncComponent } from "vue";
/** Load parsing and sanitization only when a conversation actually contains Markdown. */
export const MarkdownPreview = defineAsyncComponent(
  () => import("./MarkdownPreview.vue"),
);
