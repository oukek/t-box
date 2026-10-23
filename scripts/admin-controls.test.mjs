import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const adminRequire = createRequire(new URL('../admin/package.json', import.meta.url))
const appRequire = createRequire(new URL('../app/package.json', import.meta.url))
const { JSDOM } = await import(pathToFileURL(appRequire.resolve('jsdom')).href)
const { parse, compileScript } = adminRequire('vue/compiler-sfc')
const dom = new JSDOM('<!doctype html><html><body></body></html>')
for (const key of ['window', 'document', 'Document', 'ShadowRoot', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event']) {
  globalThis[key] = key === 'window' ? dom.window : dom.window[key]
}
const vueUrl = pathToFileURL(adminRequire.resolve('vue')).href
const { createApp, h, nextTick, ref } = await import(vueUrl)
const modules = new Map()
after(() => dom.window.close())

// Compile the actual SFCs, including their native v-model directives. A mock of
// the components would miss lost modifiers, IME composition and array binding.
function componentUrl(filename) {
  if (modules.has(filename)) {
    return modules.get(filename)
  }
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const compiled = compileScript(descriptor, { id: filename, inlineTemplate: true })
  let code = ts.transpileModule(compiled.content, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  code = code.replace(/from (['"])([^'"]+)\1/g, (original, _quote, name) => {
    if (name === 'vue') {
      return `from '${vueUrl}'`
    }
    if (name.endsWith('.vue')) {
      return `from '${componentUrl(resolve(dirname(filename), name))}'`
    }
    return original
  })
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  modules.set(filename, url)
  return url
}
async function mount(t, name, initial, props = {}, slots) {
  const filename = resolve('admin/src/components', `${name}.vue`)
  const { default: component } = await import(componentUrl(filename))
  const model = ref(initial)
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({
    setup: () => () => h('form', [h('fieldset', { disabled: props.fieldsetDisabled }, [
      h(component, { ...props, 'modelValue': model.value, 'onUpdate:modelValue': (value) => {
        model.value = value
      } }, slots),
    ])]),
  })
  app.mount(container)
  t.after(() => {
    app.unmount()
    container.remove()
  })
  return { container, model, input: container.querySelector('input, textarea') }
}
function inputEvent(input, value) {
  input.value = value
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}

test('text fields preserve IME composition, trim and required validation', async (t) => {
  const { container, input, model } = await mount(t, 'AdminInput', '', { required: true, modelModifiers: { trim: true } })
  assert.equal(container.querySelector('form').checkValidity(), false)
  input.dispatchEvent(new dom.window.CompositionEvent('compositionstart'))
  inputEvent(input, '拼音')
  assert.equal(model.value, '')
  input.dispatchEvent(new dom.window.CompositionEvent('compositionend'))
  await nextTick()
  assert.equal(model.value, '拼音')
  inputEvent(input, '  完整内容  ')
  await nextTick()
  assert.equal(model.value, '完整内容')
  assert.equal(container.querySelector('form').checkValidity(), true)
})

test('number controls emit numbers and retain min/max/step validation', async (t) => {
  const { container, input, model } = await mount(t, 'AdminInput', 2, { type: 'number', min: 1, max: 10, step: 1, required: true, modelModifiers: { number: true } })
  inputEvent(input, '5')
  await nextTick()
  assert.equal(model.value, 5)
  assert.equal(container.querySelector('form').checkValidity(), true)
  for (const invalid of ['0', '11', '1.5', '']) {
    inputEvent(input, invalid)
    await nextTick()
    assert.equal(container.querySelector('form').checkValidity(), false)
  }
})

test('textareas keep multiline content, length constraints and disabled fieldsets', async (t) => {
  const { container, input, model } = await mount(t, 'AdminTextarea', '', { required: true, maxlength: 40, rows: 6 })
  inputEvent(input, '第一行\n第二行')
  await nextTick()
  assert.equal(model.value, '第一行\n第二行')
  assert.equal(input.rows, 6)
  assert.equal(input.maxLength, 40)
  assert.equal(container.querySelector('form').checkValidity(), true)
  const disabled = await mount(t, 'AdminTextarea', '不可编辑', { fieldsetDisabled: true })
  assert.ok(disabled.input.matches(':disabled'))
})

test('checkboxes support booleans and model-pool arrays without changing the wrong selection', async (t) => {
  const boolean = await mount(t, 'AdminCheckbox', true)
  boolean.input.click()
  await nextTick()
  assert.equal(boolean.model.value, false)
  const array = await mount(t, 'AdminCheckbox', ['first'], { value: 'second' })
  assert.equal(array.input.checked, false)
  array.input.click()
  await nextTick()
  assert.deepEqual([...array.model.value], ['first', 'second'])
  array.input.click()
  await nextTick()
  assert.deepEqual([...array.model.value], ['first'])
  const disabled = await mount(t, 'AdminCheckbox', false, { fieldsetDisabled: true })
  disabled.input.click()
  assert.equal(disabled.model.value, false)
})

test('action buttons do not accidentally submit; explicit submit buttons retain form validation', async (t) => {
  const button = await mount(t, 'AdminButton', undefined)
  assert.equal(button.container.querySelector('button').type, 'button')
  const submit = await mount(t, 'AdminButton', undefined, { type: 'submit', form: 'target-form' })
  assert.equal(submit.container.querySelector('button').type, 'submit')
  assert.equal(submit.container.querySelector('button').getAttribute('form'), 'target-form')
})

test('upload controls forward actual change events and directory/multiple options; disabled fields cannot open a picker', async (t) => {
  let event
  const upload = await mount(t, 'AdminFileUpload', undefined, { label: '上传构建目录', directory: true, accept: '.png', onChange: (value) => {
    event = value
  } })
  assert.equal(upload.input.multiple, true)
  assert.ok(upload.input.hasAttribute('webkitdirectory'))
  assert.equal(upload.input.accept, '.png')
  const change = new dom.window.Event('change', { bubbles: true })
  upload.input.dispatchEvent(change)
  assert.equal(event, change)
  assert.equal(event.target, upload.input)
  const single = await mount(t, 'AdminFileUpload', undefined, { label: '选择图片', accept: '.png' })
  assert.equal(single.input.multiple, false)
  assert.equal(single.input.hasAttribute('webkitdirectory'), false)
  const disabled = await mount(t, 'AdminFileUpload', undefined, { label: '选择文件', fieldsetDisabled: true })
  let clicked = false
  disabled.input.click = () => {
    clicked = true
  }
  disabled.container.querySelector('button').click()
  assert.equal(clicked, false)
})
