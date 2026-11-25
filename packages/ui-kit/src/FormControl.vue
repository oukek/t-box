<script lang="ts">
import { defineComponent, getCurrentInstance, h, mergeProps, vModelDynamic, withDirectives } from 'vue'

// Keep the native editing surface for IME, selection, autofill and keyboard access.
export default defineComponent({
  name: 'FormControl',
  inheritAttrs: false,
  props: {
    modelValue: { type: null, default: undefined },
    modelModifiers: Object,
    type: { type: String, default: 'text' },
    multiline: Boolean,
    flat: Boolean,
  },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    const instance = getCurrentInstance()!
    return () => {
      const field = h(props.multiline ? 'textarea' : 'input', mergeProps(attrs, {
        'type': props.multiline ? undefined : props.type,
        'class': ['ark-control', { 'ark-control-flat': props.flat }],
        'onUpdate:modelValue': (value: unknown) => emit('update:modelValue', value),
      }))
      if (!instance.vnode.props?.['onUpdate:modelValue']) {
        return field
      }
      return withDirectives(field, [[vModelDynamic, props.modelValue, undefined, props.modelModifiers ?? {}]])
    }
  },
})
</script>

<style>
.ark-control.ark-control:not([type='checkbox']):not(.ark-control-flat) {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  padding: 7px 10px;
  border: 1px solid #dedee3;
  border-radius: 7px;
  box-shadow: none;
  background: #fff;
  color: inherit;
  font: inherit;
}
textarea.ark-control {
  resize: vertical;
}
input.ark-control[type='checkbox'] {
  appearance: none;
  box-sizing: border-box;
  vertical-align: middle;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid #aaaaaf;
  border-radius: 4px;
  background: white;
  cursor: pointer;
}
input.ark-control[type='checkbox']:checked {
  background: var(--accent, #64516e) center / 13px no-repeat
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m3 8 3 3 7-7' fill='none' stroke='white' stroke-width='2'/%3E%3C/svg%3E");
  border-color: transparent;
}
.ark-control:focus-visible {
  outline: 2px solid var(--accent, #64516e);
  outline-offset: 1px;
}
</style>
