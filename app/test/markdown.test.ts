import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createMarkdownRenderer } from '../src/core/markdown.js'

const dom = new JSDOM('', { url: 'https://t-box.test' })
const render = createMarkdownRenderer(dom.window)
function fragment(text: string) {
  const node = dom.window.document.createElement('div')
  node.innerHTML = render(text)
  return node
}
test('Markdown previews headings, lists, quotes, GFM tables, tasks and fenced code', () => {
  const node = fragment(
    '# 结果\n\n**加粗**与*强调*、~~删除~~和 `inline`\n\n- 项目 A\n- 项目 B\n\n> 思考摘要\n\n| 类目 | 数量 |\n| :--- | ---: |\n| 农历 | 2 |\n\n- [x] 完成\n\n```ts\nconst value = "<script>";\n```',
  )
  assert.equal(node.querySelector('h1')?.textContent, '结果')
  assert.equal(node.querySelector('strong')?.textContent, '加粗')
  assert.ok(node.querySelector('blockquote'))
  assert.equal(node.querySelectorAll('ul').length, 2)
  assert.equal(
    node.querySelector('.md-table-scroll table td[align=right]')?.textContent,
    '2',
  )
  assert.equal(
    node.querySelector<HTMLInputElement>('input[type=checkbox]')?.disabled,
    true,
  )
  assert.equal(
    node.querySelector('pre code')?.textContent,
    'const value = "<script>";\n',
  )
  assert.equal(
    node.querySelector('button.md-copy-code')?.getAttribute('type'),
    'button',
  )
  assert.equal(node.querySelector('script'), null)
})
test('stream prefixes preview unclosed fences and recover the full document without persisted synthetic text', () => {
  const text =
    '## 实时回复\n\n**已完成**\n\n```ts\nconst value = 42;\n```\n\n最后一段。'
  for (let i = 0; i <= text.length; i++) {
    const node = fragment(text.slice(0, i))
    assert.equal(node.querySelector('script,iframe,object'), null)
  }
  assert.equal(
    fragment('```ts\nconst value = 42;').querySelector('pre code')?.textContent,
    'const value = 42;\n',
  )
  assert.equal(fragment(text).querySelectorAll('pre').length, 1)
  assert.match(fragment(text).textContent!, /最后一段。/)
  assert.equal(render(''), '')
})
test('untrusted model HTML, event handlers, embedded documents and executable protocols cannot execute', () => {
  const payload =
    '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n<iframe srcdoc="<script>alert(1)</script>"></iframe>\n<svg onload=alert(1)>\n\n[攻击](javascript:alert%281%29)\n\n[编码](java&#x73;cript:alert%281%29)\n\n![攻击](data:image/svg+xml;base64,PHN2Zz4=)'
  const node = fragment(payload)
  assert.equal(
    node.querySelector('script,iframe,svg,object,embed,form,style'),
    null,
  )
  assert.equal(node.querySelector('[onerror],[onload],[srcdoc]'), null)
  assert.equal(node.querySelectorAll('a[href],img[src]').length, 0)
  assert.ok(node.textContent?.includes('<script>'))
  assert.equal(node.querySelector('button'), null)
})
test('safe Markdown links and images use safe attributes; incomplete links stay readable', () => {
  const node = fragment(
    '[官网](https://example.com/?a=1&b=2 "标题")\n\n![图片](https://example.com/image.png)\n\n[邮件](mailto:hello@example.com)',
  )
  const link = node.querySelector('a')!
  assert.equal(link.getAttribute('target'), '_blank')
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer')
  assert.equal(link.getAttribute('href'), 'https://example.com/?a=1&b=2')
  assert.equal(
    node.querySelector('img')?.getAttribute('referrerpolicy'),
    'no-referrer',
  )
  assert.equal(node.querySelector('img')?.getAttribute('loading'), 'lazy')
  assert.match(fragment('[尚未完成](https://exam').textContent!, /尚未完成/)
  assert.equal(
    fragment('[本地文件](file:///etc/passwd)').querySelector('a'),
    null,
  )
  assert.equal(
    fragment('[数据](data:text/html,hello)').querySelector('a'),
    null,
  )
})
test('long code and tables are wrapped in independent scroll areas; repeated rendering stays deterministic', () => {
  const text =
    '| 项目 | 描述 |\n| --- | --- |\n| 示例 | ' +
    '内容'.repeat(200) +
    ' |\n\n```txt\n' +
    'x'.repeat(2000) +
    '\n```'
  const node = fragment(text)
  assert.ok(node.querySelector('.md-table-scroll'))
  assert.ok(node.querySelector('.md-code-block pre'))
  assert.equal(render(text), render(text))
})
