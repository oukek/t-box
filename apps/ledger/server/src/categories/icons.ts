import type { EntityManager } from 'typeorm'
import { ApiError } from '@t-box/server-foundation/errors'
import { parseId } from '../validation.js'
// MySQL BLOB stores at most 65,535 bytes.
export const CATEGORY_ICON_MAX_BYTES = 64 * 1024 - 1
/** Only bounded raster thumbnails are served inline. Never accept SVG or arbitrary URLs. */
export function categoryIconBytes(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    value.length > 90000 ||
    value.length % 4 ||
    !/^[A-Z0-9+/]+={0,2}$/i.test(value)
  ) {
    throw new ApiError(400, 'INVALID_CATEGORY_ICON', '图标图片编码无效')
  }
  const bytes = Buffer.from(value, 'base64')
  if (
    bytes.length < 33 ||
    bytes.length > CATEGORY_ICON_MAX_BYTES ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.readUInt32BE(16) < 1 ||
      bytes.readUInt32BE(20) < 1 ||
      bytes.readUInt32BE(16) > 128 ||
      bytes.readUInt32BE(20) > 128
  ) {
    throw new ApiError(
      400,
      'INVALID_CATEGORY_ICON',
      '请上传不超过 128×128、64 KB 的 PNG 图标',
    )
  }
  return bytes
}
export async function validateCategoryIcon(
  db: EntityManager,
  book: string,
  user: string,
  value: unknown,
): Promise<string | null> {
  if (value === undefined || value === null) {
    return null
  }
  const id = parseId(value)
  const [row] = await db.query(
    `SELECT id FROM ledger_category_icons i WHERE i.id=? AND i.ledger_id=?
    AND (i.created_by=? OR EXISTS(SELECT 1 FROM bill_categories c WHERE c.ledger_id=? AND c.icon_id=i.id)) FOR SHARE`,
    [id, book, user, book],
  )
  if (!row) {
    throw new ApiError(
      404,
      'CATEGORY_ICON_NOT_FOUND',
      '图标不存在或不属于当前账本',
    )
  }
  return id
}
