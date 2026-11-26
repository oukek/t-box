import { invalid } from '@t-box/server-foundation/errors'

export function publicationNotes(input: unknown) {
  if (typeof input !== 'string' || !input.trim()) {
    throw invalid('notes', '请填写更新内容')
  }
  const fallback = '优化修复 bug'
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line !== fallback)
  const notes = [...lines, fallback].join('\n')
  if (notes.length > 1000) {
    throw invalid('notes', '更新内容最多 1000 字（含末项）')
  }
  return notes
}
