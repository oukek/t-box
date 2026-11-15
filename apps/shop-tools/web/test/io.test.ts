import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { defaultConfig, newRow, newSheet } from '../../core/src/index.js'
import { exportBook, importBook } from '../src/excel.js'

test('Excel exports snapshot, protected outputs, metadata and preserves SKU on import', async () => {
  const sheet = newSheet('测试', defaultConfig().basic)
  sheet.rows = [
    {
      ...newRow(defaultConfig().basic),
      sku: '00012',
      cost: 100,
      weight: 0.5,
      target: 20,
    },
  ]
  const buffer = await exportBook([sheet], () => undefined)
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(buffer)
  assert.equal(book.getWorksheet('_定价配置')?.state, 'veryHidden')
  assert.ok(book.getWorksheet('计算说明'))
  const ws = book.worksheets[1]!
  assert.equal(ws.getRow(2).getCell(1).value, '00012')
  assert.notEqual(ws.getRow(2).getCell(11).protection?.locked, false)
  assert.equal(ws.getRow(2).getCell(1).protection?.locked, false)
  const restored = await importBook(
    buffer as ArrayBuffer,
    defaultConfig().basic,
    sheet.settings,
  )
  assert.equal(restored[0]?.rows[0]?.sku, '00012')
  assert.equal(restored[0]?.rows[0]?.loss, 4)
})
test('Excel formula inputs are rejected', async () => {
  const sheet = newSheet('公式')
  const buffer = await exportBook([sheet], () => undefined, true)
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(buffer)
  book.worksheets[1]!.getRow(2).getCell(3).value = { formula: '1+1', result: 2 }
  await assert.rejects(
    () =>
      book.xlsx
        .writeBuffer()
        .then((b) => importBook(b as ArrayBuffer, {}, sheet.settings)),
    /公式/,
  )
})
