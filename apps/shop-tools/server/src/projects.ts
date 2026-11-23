import type { BackendInvocation } from '@t-box/app-contracts'
import type { ProjectRole, ProjectSummary } from '@t-box/shop-tools-contracts'
import type { EntityManager } from 'typeorm'
import { fingerprint } from '@t-box/server-foundation/persistence/operations'
import { ShopError } from '@t-box/shop-tools-contracts'
import { In, MoreThan } from 'typeorm'
import { InviteEntity, MemberEntity, ProjectEntity, ShopWorkspaceEntity } from './entities.js'

const ranks = { viewer: 0, editor: 1, admin: 2, owner: 3 }
function name(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) {
    throw ShopError.invalid('名称须为 1–80 个字符')
  }
  return value.trim()
}
function projectId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw ShopError.invalid('项目标识无效')
  }
  return value
}
export async function authorize(db: EntityManager, subject: string, value: unknown, minimum: ProjectRole) {
  const id = projectId(value)
  const project = await db.findOne(ProjectEntity, { where: { id }, lock: { mode: minimum === 'viewer' ? 'pessimistic_read' : 'pessimistic_write' } })
  const member = await db.findOneBy(MemberEntity, { project: id, subject })
  if (!project || !member || ranks[member.role] < ranks[minimum]) {
    throw ShopError.denied()
  }
  return member
}
export async function projects(db: EntityManager, r: BackendInvocation) {
  const arg = (r.arguments || {}) as Record<string, unknown>
  const subject = r.subject
  if (arg.action === 'list') {
    // The original personal workspace already uses this key for all its rows.
    if (!await db.existsBy(ProjectEntity, { id: subject })) {
      await db.insert(ProjectEntity, { id: subject, name: '默认项目' })
      await db.insert(MemberEntity, { project: subject, subject, name: '创建者', role: 'owner' })
    }
    const memberships = await db.findBy(MemberEntity, { subject })
    const rows = await db.findBy(ProjectEntity, { id: In(memberships.map((m) => m.project)) })
    return rows.map((p) => ({ ...p, role: memberships.find((m) => m.project === p.id)!.role } satisfies ProjectSummary))
      .sort((a, b) => Number(b.id === subject) - Number(a.id === subject) || a.name.localeCompare(b.name))
  }
  if (arg.action === 'create') {
    const id = fingerprint(['shop-project', subject, r.invocationId])
    const title = name(arg.name)
    if (!await db.existsBy(ProjectEntity, { id })) {
      await db.insert(ProjectEntity, { id, name: title })
      await db.insert(MemberEntity, { project: id, subject, name: '创建者', role: 'owner' })
      await db.insert(ShopWorkspaceEntity, { subject: id, generation: 1, releaseId: 'project', active: true, revision: 0, metadata: null, config: null, history: null, updatedAt: new Date() })
    }
    return { id }
  }
  if (arg.action === 'join') {
    if (typeof arg.code !== 'string' || !/^[0-9a-f]{32}$/.test(arg.code)) {
      throw ShopError.invalid('邀请码无效')
    }
    const id = fingerprint(arg.code)
    const first = await db.findOneBy(InviteEntity, { id })
    if (!first) {
      throw ShopError.invalid('邀请已失效')
    }
    await db.findOneOrFail(ProjectEntity, { where: { id: first.project }, lock: { mode: 'pessimistic_write' } })
    const invite = await db.findOne(InviteEntity, { where: { id }, lock: { mode: 'pessimistic_write' } })
    if (!invite || invite.expiresAt.getTime() <= Date.now()) {
      throw ShopError.invalid('邀请已失效')
    }
    if (await db.existsBy(MemberEntity, { project: invite.project, subject })) {
      throw ShopError.invalid('你已是此项目成员')
    }
    await db.insert(MemberEntity, { project: invite.project, subject, name: name(arg.name), role: invite.role })
    if (invite.remaining === 1) await db.delete(InviteEntity, { id })
    else await db.update(InviteEntity, { id }, { remaining: invite.remaining - 1 })
    return { id: invite.project }
  }
  const project = projectId(arg.projectId)
  const caller = await authorize(db, subject, project, ['members', 'leave'].includes(String(arg.action)) ? 'viewer' : 'admin')
  const canGrant = (role: unknown): role is 'viewer' | 'editor' | 'admin' =>
    role === 'viewer' || role === 'editor' || (role === 'admin' && caller.role === 'owner')
  if (arg.action === 'members') {
    return { members: await db.findBy(MemberEntity, { project }), invites: ranks[caller.role] >= 2 ? await db.findBy(InviteEntity, { project, expiresAt: MoreThan(new Date()) }) : [] }
  }
  if (arg.action === 'leave') {
    if (caller.role === 'owner') throw ShopError.denied()
    await db.delete(MemberEntity, { project, subject })
  } else if (arg.action === 'rename') {
    await db.update(ProjectEntity, { id: project }, { name: name(arg.name) })
  } else if (arg.action === 'invite' && canGrant(arg.role)) {
    const days = Number(arg.days ?? 1)
    const remaining = Number(arg.maxUses ?? 1)
    if (!Number.isInteger(days) || days < 1 || days > 7 || !Number.isInteger(remaining) || remaining < 1 || remaining > 20) {
      throw ShopError.invalid('有效期须为 1–7 天，邀请人数须为 1–20 人')
    }
    const code = crypto.randomUUID().replaceAll('-', '')
    await db.insert(InviteEntity, { id: fingerprint(code), project, role: arg.role, remaining, expiresAt: new Date(Date.now() + days * 86400000) })
    return { code }
  } else if (arg.action === 'revoke') {
    const invite = await db.findOneBy(InviteEntity, { project, id: projectId(arg.id) })
    if (!invite || !canGrant(invite.role)) {
      throw ShopError.denied()
    }
    await db.delete(InviteEntity, { id: invite.id })
  } else if (arg.action === 'role' || arg.action === 'remove') {
    const target = await db.findOneBy(MemberEntity, { project, subject: projectId(arg.subject) })
    if (!target || !canGrant(target.role)) {
      throw ShopError.denied()
    }
    if (arg.action === 'remove') {
      await db.remove(MemberEntity, target)
    } else if (canGrant(arg.role)) {
      await db.update(MemberEntity, { project, subject: target.subject }, { role: arg.role })
    } else {
      throw ShopError.denied()
    }
  } else {
    throw ShopError.denied()
  }
  return {}
}
