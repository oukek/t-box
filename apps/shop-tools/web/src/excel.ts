import type {
  Config,
  Route,
  Settings,
  Sheet,
} from '@t-box/shop-tools-contracts'
import { inputs, outputs, ShopError } from '@t-box/shop-tools-contracts'
import {
  calculate,
  hasProduct,
  newRow,
  newSheet,
  validateBook,
} from '@t-box/shop-tools-core'

export async function exportBook(
  sheets: Sheet[],
  routeFor: (s: Sheet) => Route | undefined,
  template = false,
) {
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  book.creator = 'T方舟 · 跨境运营助手'
  const meta = book.addWorksheet('_定价配置')
  meta.addRow(['版本', 1])
  meta.addRow([
    '说明',
    '输入可编辑，结果为快照；修改后请导回应用重算。历史日期仅还原物流规则。',
  ])
  for (const [index, sheet] of sheets.entries()) {
    const route = routeFor(sheet)
    const name = `${index + 1} ${sheet.name}`
      .replace(/[\\/*?:[\]]/g, ' ')
      .slice(0, 31)
    const ws = book.addWorksheet(name, {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
    })
    const columns = [
      ...inputs.map(([key, label]) => ({ key, label })),
      ...outputs.flatMap(([key, label]) => {
        const currency =
          key === 'profit'
            ? 'CNY'
            : key === 'margin'
              ? '%'
              : route?.currency || '本币'
        const main = { key: `out_${key}`, label: `${label}（${currency}）` }
        return currency !== 'CNY' && currency !== '%'
          ? [main, { key: `${key}_cny`, label: `${label}（CNY参考）` }]
          : [main]
      }),
      { key: 'status', label: '计算状态' },
    ]
    ws.columns = columns.map((c) => ({
      key: c.key,
      header: c.label,
      width: 22,
    }))
    for (const row of template ? [newRow()] : sheet.rows.filter(hasProduct)) {
      const values: Record<string, unknown> = { ...row }
      try {
        if (!template) {
          if (!route) {
            throw ShopError.invalid('未选择物流方案')
          }
          const result = calculate(row, sheet.settings, route)
          for (const [key] of outputs) {
            values[`out_${key}`] = result[key]
          }
          values.status = '已计算'
          for (const [key] of outputs) {
            if (key !== 'profit' && key !== 'margin') {
              values[`${key}_cny`] = result[key] / route.exchange
            }
          }
        }
      } catch (error) {
        values.status = error instanceof Error ? error.message : '计算失败'
      }
      const excelRow = ws.addRow(values)
      for (let c = 1; c <= columns.length; c++) {
        const cell = excelRow.getCell(c)
        cell.protection = { locked: c > inputs.length }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: c <= inputs.length ? 'FFEFF7FF' : 'FFF1F3F6' },
        }
        if (c <= 2) {
          cell.numFmt = '@'
        }
      }
    }
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF34465A' },
    }
    ws.autoFilter = {
      from: 'A1',
      to: { row: ws.rowCount, column: columns.length },
    }
    await ws.protect('', {
      selectLockedCells: true,
      selectUnlockedCells: true,
      autoFilter: true,
      spinCount: 1000,
    })
    meta.addRow([
      name,
      JSON.stringify({
        name: sheet.name,
        settings: sheet.settings,
        routeSnapshot: route || null,
        exportedAt: new Date().toISOString(),
      }),
    ])
  }
  meta.state = 'veryHidden'
  const info = book.addWorksheet('计算说明')
  info.columns = [{ width: 28 }, { width: 110 }]
  for (const row of [
    ['结果快照', 'Excel 内不自动计算，修改输入后请导回方舟重新计算。'],
    [
      '计算口径',
      '成本、境内运费、目标利润为人民币；目标售价为站点本币；利润率=汇损后利润折成本币/折后售价。',
    ],
    ['汇损', '定价汇率=市场汇率/(1−预留汇损)，汇损仅扣减提现后的净回款。'],
    ['历史日期', '只还原物流规则，佣金和汇率为获取时的数据。'],
    ['印尼固定费', '沿用原项目每单3000 IDR，尚未核验现行政策。'],
    ...sheets.map((s) => [
      s.name,
      JSON.stringify({ ...s.settings, route: routeFor(s) }),
    ]),
  ]) {
    const r = info.addRow(row)
    r.alignment = { wrapText: true }
    r.height = 48
  }
  return book.xlsx.writeBuffer()
}
export async function importBook(
  buffer: ArrayBuffer,
  defaults: Config['basic'],
  settings: Settings,
): Promise<Sheet[]> {
  if (buffer.byteLength > 10 * 1024 * 1024) {
    throw ShopError.invalid('文件不能超过10MB')
  }
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(buffer)
  const meta = new Map<string, { name: string, settings: Settings }>()
  const metadata = book.getWorksheet('_定价配置')
  metadata?.eachRow((r, i) => {
    if (i > 2) {
      meta.set(
        String(r.getCell(1).value),
        JSON.parse(String(r.getCell(2).value)),
      )
    }
  })
  const sheets: Sheet[] = []
  for (const ws of book.worksheets) {
    if (ws.name === '_定价配置' || (metadata && ws.name === '计算说明')) {
      continue
    }
    if (sheets.length >= 20 || ws.rowCount > 1001) {
      throw ShopError.invalid('最多20个工作表，每表1000行')
    }
    const columns = new Map<string, number>()
    ws.getRow(1).eachCell((c, i) => {
      const col = inputs.find(
        ([, label]) =>
          String(c.value).trim() === label ||
          (label === '目标值' &&
            /^(?:目标利润（CNY）|目标利润率（%）|目标售价（[^）]+）)$/.test(
              String(c.value).trim(),
            )),
      )
      if (col) {
        columns.set(col[0], i)
      }
    })
    if (!['cost', 'weight', 'target'].every((k) => columns.has(k))) {
      throw ShopError.invalid(`${ws.name} 缺少成本、重量或目标值列，请使用模板`)
    }
    const saved = meta.get(ws.name)
    const sheet = newSheet(saved?.name || ws.name, defaults)
    sheet.settings = { ...settings, ...saved?.settings }
    sheet.rows = []
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = newRow(defaults)
      for (const [key] of inputs) {
        const index = columns.get(key)
        if (!index) {
          continue
        }
        const value = ws.getRow(i).getCell(index).value
        if (value && typeof value === 'object') {
          if ('richText' in value) {
            row[key] = value.richText.map((t) => t.text).join('')
          } else {
            throw ShopError.invalid(
              '输入列不能包含公式或复杂对象，请先粘贴为数值',
            )
          }
        } else {
          row[key] =
            value == null
              ? ''
              : typeof value === 'number'
                ? value
                : String(value)
        }
      }
      if (hasProduct(row)) {
        sheet.rows.push(row)
      }
    }
    if (!sheet.rows.length) {
      sheet.rows.push(newRow(defaults))
    }
    sheets.push(sheet)
  }
  return validateBook({ version: 1, activeSheetId: sheets[0]?.id, sheets })
    .sheets
}
export function download(buffer: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
