import type { DesktopDevice, DesktopLayout } from '@t-box/shared'
import type { DataSource } from 'typeorm'
import type { ApplicationPlatform } from '../application-platform/service.js'
import { createHash } from 'node:crypto'
import { ApiError } from '@t-box/server-foundation/errors'
import {
  reconcileDesktopOrder,
  systemApplicationManifests,
} from '@t-box/shared'

export const desktopDevice = (value: unknown): DesktopDevice => {
  if (value !== 'mobile' && value !== 'pc') {
    throw new ApiError(400, 'INVALID_DESKTOP_DEVICE', '请选择移动端或 PC 桌面')
  }
  return value
}
/** The client can reorder installed apps, never declare installation type or remove system apps. */
export class DesktopService {
  readonly manifests = systemApplicationManifests
  readonly catalogRevision = createHash('sha256')
    .update(JSON.stringify(this.manifests.map((m) => m.id)))
    .digest('hex')

  constructor(
    private readonly source: DataSource,
    private readonly platform?: ApplicationPlatform,
  ) {}

  async applications(
    userId: string,
  ): Promise<import('@t-box/shared').DesktopApplication[]> {
    if (!this.platform) {
      return this.manifests.map((manifest) => ({
        manifest,
        installation: { kind: 'system' as const, uninstallable: false },
        aiAvailable: manifest.skillIds.length > 0,
      }))
    }
    const catalog = await this.platform.catalog(userId)
    const entries = await Promise.all(catalog.filter((e) => e.release.kind === 'system' || (e.installation && e.installation.status !== 'revoked')).map(async (e) => ({
      manifest: e.installation?.status === 'active' ? (await this.platform!.release(e.installation.releaseId)).manifest : e.release.manifest,
      installation: {
        kind: e.release.kind,
        uninstallable: e.release.kind !== 'system',
        installationId: `${e.release.appId}:${e.installation?.generation || 0}`,
        status: e.installation?.status || 'failed',
        error: e.installation?.error || e.issue || null,
      },
      aiAvailable: e.installation?.status === 'active' && e.release.manifest.skillIds.length > 0,
    })))
    for (const manifest of this.manifests) {
      if (this.platform.applicationKind(manifest.id) === 'system' && !entries.some((e) => e.manifest.id === manifest.id)) {
        entries.push({ manifest, installation: { kind: 'system', uninstallable: false, installationId: `${manifest.id}:0`, status: 'failed', error: this.platform.deploymentIssue(manifest.id) || '应用尚未部署' }, aiAvailable: false })
      }
    }
    const order = new Map(this.manifests.map((manifest, index) => [manifest.id, index]))
    return entries.sort((a, b) => (order.get(a.manifest.id) ?? this.manifests.length) - (order.get(b.manifest.id) ?? this.manifests.length) || a.manifest.id.localeCompare(b.manifest.id))
  }

  private async available(userId: string) {
    const entries = await this.applications(userId)
    return {
      ids: entries.map((e) => e.manifest.id),
      revision: createHash('sha256')
        .update(
          JSON.stringify(
            [...entries]
              .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
              .map((e) => [
                e.manifest.id,
                e.manifest.version,
                e.installation.installationId,
              ]),
          ),
        )
        .digest('hex'),
    }
  }

  private layout(
    device: DesktopDevice,
    available: { ids: string[], revision: string },
    row?: { app_ids: string | string[], revision: number },
  ): DesktopLayout {
    const saved = row
      ? typeof row.app_ids === 'string'
        ? JSON.parse(row.app_ids)
        : row.app_ids
      : []
    return {
      device,
      revision: Number(row?.revision || 0),
      catalogRevision: available.revision,
      appIds: reconcileDesktopOrder(saved, available.ids),
    }
  }

  async get(userId: string, device: DesktopDevice): Promise<DesktopLayout> {
    const [row] = await this.source.query(
      'SELECT app_ids,revision FROM user_desktop_layouts WHERE user_id=? AND device=?',
      [userId, device],
    )
    return this.layout(device, await this.available(userId), row)
  }

  async save(
    userId: string,
    device: DesktopDevice,
    value: unknown,
  ): Promise<DesktopLayout> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ApiError(400, 'INVALID_DESKTOP_LAYOUT', '桌面排序格式无效')
    }
    const body = value as Record<string, unknown>
    if (
      Object.keys(body).some(
        (k) => !['revision', 'catalogRevision', 'appIds'].includes(k),
      ) ||
      !Number.isSafeInteger(body.revision) ||
      Number(body.revision) < 0 ||
      !Array.isArray(body.appIds) ||
      body.appIds.length > 200 ||
      body.appIds.some((id) => typeof id !== 'string') ||
      new Set(body.appIds).size !== body.appIds.length
    ) {
      throw new ApiError(400, 'INVALID_DESKTOP_LAYOUT', '桌面排序或版本无效')
    }
    const availability = await this.available(userId)
    if (body.catalogRevision !== availability.revision) {
      throw new ApiError(
        409,
        'DESKTOP_CATALOG_CHANGED',
        '应用列表已更新，请刷新桌面',
      )
    }
    const available = availability.ids
    if (
      body.appIds.length !== available.length ||
      body.appIds.some((id) => !available.includes(id))
    ) {
      throw new ApiError(
        400,
        'DESKTOP_APP_MISMATCH',
        '排序须包含所有已安装应用，不能移除系统应用',
      )
    }
    return this.source.transaction(async (db) => {
      // Serializes initial inserts as well as later changes, scoped to the authenticated account.
      const users = await db.query(
        'SELECT id FROM app_users WHERE id=? FOR UPDATE',
        [userId],
      )
      if (!users.length) {
        throw new ApiError(401, 'UNAUTHENTICATED', '请重新登录')
      }
      if (this.platform) {
        const rows = await db.query(
          'SELECT i.app_id,i.generation,r.definition FROM application_installations i JOIN application_releases r ON r.release_id=i.release_id WHERE i.user_id=? AND i.status=\'active\' ORDER BY r.created_at,r.app_id',
          [userId],
        )
        const revision = createHash('sha256')
          .update(
            JSON.stringify(
              rows
                .sort((a: { app_id: string }, b: { app_id: string }) =>
                  a.app_id.localeCompare(b.app_id),
                )
                .map(
                  (r: {
                    app_id: string
                    generation: number
                    definition: string | { manifest: { version: string } }
                  }) => [
                    r.app_id,
                    (typeof r.definition === 'string'
                      ? JSON.parse(r.definition)
                      : r.definition
                    ).manifest.version,
                    `${r.app_id}:${r.generation}`,
                  ],
                ),
            ),
          )
          .digest('hex')
        if (revision !== availability.revision) {
          throw new ApiError(
            409,
            'DESKTOP_CATALOG_CHANGED',
            '应用列表已更新，请刷新桌面',
          )
        }
      }
      const [row] = await db.query(
        'SELECT app_ids,revision FROM user_desktop_layouts WHERE user_id=? AND device=? FOR UPDATE',
        [userId, device],
      )
      const current = this.layout(device, availability, row)
      if (JSON.stringify(current.appIds) === JSON.stringify(body.appIds)) {
        return current
      } // Recover a lost successful response safely.
      if (current.revision !== body.revision) {
        throw new ApiError(
          409,
          'DESKTOP_LAYOUT_CHANGED',
          '桌面已在其他窗口更新，请刷新后重新整理',
        )
      }
      const revision = current.revision + 1
      await db.query(
        'INSERT INTO user_desktop_layouts(user_id,device,app_ids,revision) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE app_ids=VALUES(app_ids),revision=VALUES(revision),updated_at=UTC_TIMESTAMP(3)',
        [userId, device, JSON.stringify(body.appIds), revision],
      )
      return { ...current, appIds: body.appIds as string[], revision }
    })
  }
}
