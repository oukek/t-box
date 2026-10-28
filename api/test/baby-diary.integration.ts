import type { LifecycleRequest } from '@t-box/app-contracts'
import type { Actor } from '@t-box/app-server-sdk'
import type {
  BabyProfile,
  BabyRecord,
  CreativeProject,
} from '@t-box/baby-diary-contracts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultPlayback } from '@t-box/baby-diary-contracts'
import {
  babyDiaryRelease,
  BabyDiaryService,
  createBabyDiaryModule,
} from '@t-box/baby-diary-server'
import {
  PrivateFileEntity,
  PrivateFileQuotaEntity,
} from '@t-box/server-foundation/persistence/private-media'
import sharp from 'sharp'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import { ApplicationReleaseEntity } from '../src/db/records/index.js'
import { IdentityService } from '../src/identity/service.js'
import { PrivateApplicationFiles } from '../src/resources/private-files.js'
import {
  LocalResourceStorage,
  ResourceStorageRegistry,
} from '../src/resources/storage.js'
import { assertDisposableDatabase, cleanupUsers } from './fixtures.js'

assertDisposableDatabase(getConfig().mysql.database)
const source = await createDataSource().initialize()
const directory = await mkdtemp(join(tmpdir(), 'tbox-baby-private-'))
const applications = new ApplicationPlatform(source, [babyDiaryRelease], {
  'baby-diary': 'user',
})
const files = new PrivateApplicationFiles(
  source,
  applications,
  new ResourceStorageRegistry('test-private', [
    { id: 'test-private', storage: new LocalResourceStorage(directory) },
  ]),
)
const babyDiary = new BabyDiaryService(source, files.port('baby-diary'))
files.bind('baby-diary', babyDiary.mediaPolicy)
const lifecycleRequests: LifecycleRequest[] = []
const backend = babyDiary.backend()
applications.bind('baby-diary', {
  ...backend,
  lifecycle: (request) => {
    lifecycleRequests.push(request)
    return backend.lifecycle(request)
  },
})
const updateRelease = {
  ...babyDiaryRelease,
  releaseId: 'baby-diary-fixture-update',
  manifest: { ...babyDiaryRelease.manifest, version: '99.0.0' },
}
const identity = new IdentityService(source, undefined, 'internal')
const actors: Actor[] = []
const babyIds: string[] = []
async function actor(name: string) {
  const session = await identity.register(
    {
      username: `baby_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
      nickname: name,
    },
    randomUUID(),
  )
  const value = await identity.authenticate(session.token)
  actors.push(value)
  const operation = await applications.change(
    value.user.id,
    'baby-diary',
    'install',
    babyDiaryRelease.releaseId,
    randomUUID(),
    [...babyDiaryRelease.permissions],
  )
  assert.equal(operation.status, 'completed')
  return value
}
async function invoke<T>(
  actor: Actor,
  method: string,
  args: unknown = {},
  key = randomUUID(),
) {
  const { installation } = await applications.assertActive(
    actor.user.id,
    'baby-diary',
  )
  return applications.invoke(
    actor.user.id,
    'baby-diary',
    installation.releaseId,
    installation.generation,
    method,
    args,
    key,
  ) as Promise<T>
}
const denied = (work: Promise<unknown>) =>
  assert.rejects(
    work,
    (e: unknown) =>
      !!e &&
      typeof e === 'object' &&
      'statusCode' in e &&
      [403, 404, 409, 410].includes(Number(e.statusCode)),
  )
try {
  await applications.initialize()
  const owner = await actor('妈妈')
  const editor = await actor('爸爸')
  const viewer = await actor('外婆')
  const stranger = await actor('其他用户')
  const ownerSubject = applications.subject(owner.user.id, 'baby-diary')
  const editorSubject = applications.subject(editor.user.id, 'baby-diary')
  const viewerSubject = applications.subject(viewer.user.id, 'baby-diary')
  const createKey = randomUUID()
  const create = {
    baby: {
      name: '小满',
      birthDate: '2026-01-01',
      sex: 'unknown',
      timezone: 'Asia/Shanghai',
    },
    displayName: '妈妈',
  }
  const baby = await invoke<BabyProfile>(
    owner,
    'babies_create',
    create,
    createKey,
  )
  babyIds.push(baby.id)
  assert.equal(baby.theme, null)
  assert.deepEqual(
    await invoke(owner, 'babies_create', create, createKey),
    baby,
  )
  await denied(invoke(stranger, 'babies_get', { babyId: baby.id }))
  assert.equal(
    (await invoke<BabyProfile[]>(stranger, 'babies_list')).length,
    0,
  )
  async function inviteJoin(
    target: Actor,
    role: string,
    scopes: string[],
    allowExport = false,
  ) {
    const invitation = await invoke<{ token: string }>(
      owner,
      'invites_create',
      { babyId: baby.id, role, scopes, allowExport, days: 7, maxUses: 1 },
    )
    return invoke<BabyProfile>(target, 'invites_accept', {
      token: invitation.token,
      displayName: target.user.nickname,
    })
  }
  await inviteJoin(editor, 'editor', ['diary', 'creative'])
  await inviteJoin(viewer, 'viewer', ['diary', 'growth', 'creative'])
  // Theme changes are profile management, persisted for all members. Omitted
  // fields from an older client preserve the explicitly chosen preference.
  const readProfile = () => invoke<BabyProfile>(owner, 'babies_get', { babyId: baby.id })
  const setTheme = async (theme: BabyProfile['theme']) => invoke<BabyProfile>(owner, 'babies_update', {
    babyId: baby.id,
    revision: (await readProfile()).revision,
    baby: { ...create.baby, theme },
  })
  assert.equal((await setTheme('blue')).theme, 'blue')
  assert.equal((await invoke<BabyProfile>(viewer, 'babies_get', { babyId: baby.id })).theme, 'blue')
  assert.equal((await invoke<BabyProfile[]>(editor, 'babies_list'))[0]?.theme, 'blue')
  for (const member of [editor, viewer]) {
    await denied(invoke(member, 'babies_update', {
      babyId: baby.id,
      revision: (await readProfile()).revision,
      baby: { ...create.baby, theme: 'pink' },
    }))
  }
  const priorTheme = await readProfile()
  await assert.rejects(invoke(owner, 'babies_update', {
    babyId: baby.id,
    revision: priorTheme.revision,
    baby: { ...create.baby, theme: 'purple' },
  }))
  assert.equal((await readProfile()).revision, priorTheme.revision)
  assert.equal((await invoke<BabyProfile>(owner, 'babies_update', {
    babyId: baby.id,
    revision: priorTheme.revision,
    baby: { ...create.baby, sex: 'female' },
  })).theme, 'blue')
  assert.equal((await setTheme(null)).theme, null)
  assert.equal((await setTheme('neutral')).theme, 'neutral')
  const replayKey = randomUUID()
  const replayInput = {
    babyId: baby.id,
    role: 'viewer',
    scopes: ['diary'],
    allowExport: false,
    days: 7,
    maxUses: 1,
  }
  const invitation = await invoke<{ token: string }>(
    owner,
    'invites_create',
    replayInput,
    replayKey,
  )
  assert.ok(invitation.token)
  assert.equal(
    (
      await invoke<{ token: string | null }>(
        owner,
        'invites_create',
        replayInput,
        replayKey,
      )
    ).token,
    null,
  )
  const png = await sharp({
    create: { width: 32, height: 40, channels: 3, background: '#c99bb3' },
  })
    .jpeg()
    .withExif({ IFD0: { Artist: 'private family fixture' } })
    .toBuffer()
  const photo = await files.upload(
    owner,
    'baby-diary',
    { type: 'diary', id: baby.id },
    '私密照片.png',
    png,
  )
  assert.equal('url' in photo, false)
  await denied(files.read(viewer, 'baby-diary', photo.id)) // pending draft belongs to its uploader
  const input = {
    kind: 'diary',
    date: '2026-10-01',
    title: '第一次去公园',
    text: '今天笑得很开心。',
    tags: ['出游'],
    assetIds: [photo.id],
    visibility: 'members',
    measurement: null,
  }
  const addKey = randomUUID()
  const payload = { babyId: baby.id, records: [input] }
  const [record] = await invoke<BabyRecord[]>(
    owner,
    'records_add',
    payload,
    addKey,
  )
  assert.ok(record)
  assert.deepEqual(await invoke(owner, 'records_add', payload, addKey), [
    record,
  ])
  const content = await files.read(viewer, 'baby-diary', photo.id)
  assert.equal(content.file.mimeType, 'image/jpeg')
  assert.equal(
    (await sharp(Buffer.from(content.base64, 'base64')).metadata()).exif,
    undefined,
  )
  const original = await files.read(owner, 'baby-diary', photo.id, true)
  assert.ok(
    (await sharp(Buffer.from(original.base64, 'base64')).metadata()).exif,
  )
  await denied(files.read(viewer, 'baby-diary', photo.id, true))
  await denied(files.read(stranger, 'baby-diary', photo.id))
  const attachment = await files.upload(
    owner,
    'baby-diary',
    { type: 'diary', id: baby.id },
    '任意文件.txt',
    Buffer.from('private file'),
  )
  await invoke(owner, 'records_add', {
    babyId: baby.id,
    records: [{ ...input, title: '文件记录', assetIds: [attachment.id] }],
  })
  await denied(files.read(viewer, 'baby-diary', attachment.id, false)) // no preview means an original-file download
  await denied(invoke(viewer, 'records_add', payload))
  await denied(
    invoke(editor, 'records_update', {
      babyId: baby.id,
      recordId: record.id,
      revision: 1,
      record: input,
    }),
  )
  await denied(invoke(editor, 'growth_get', { babyId: baby.id }))
  // Mixed-type batch rolls back completely when one record lacks scope permission.
  const mixed = {
    babyId: baby.id,
    records: [
      { ...input, assetIds: [], title: '不能部分写入' },
      {
        ...input,
        kind: 'measurement',
        title: '',
        assetIds: [],
        measurement: { heightMm: 700, method: 'lying' },
      },
    ],
  }
  await denied(invoke(editor, 'records_add', mixed))
  assert.equal(
    (
      await invoke<{ records: BabyRecord[] }>(owner, 'records_list', {
        babyId: baby.id,
      })
    ).records.length,
    2,
  )
  const privatePhoto = await files.upload(
    owner,
    'baby-diary',
    { type: 'private-diary', id: baby.id },
    '管理者照片.png',
    png,
  )
  await invoke(owner, 'records_add', {
    babyId: baby.id,
    records: [
      {
        ...input,
        title: '仅管理者',
        visibility: 'managers',
        assetIds: [privatePhoto.id],
      },
    ],
  })
  await denied(files.read(viewer, 'baby-diary', privatePhoto.id))
  assert.equal(
    (
      await invoke<{ records: BabyRecord[] }>(viewer, 'records_list', {
        babyId: baby.id,
      })
    ).records.length,
    2,
  )
  await invoke(owner, 'records_update', {
    babyId: baby.id,
    recordId: record.id,
    revision: 1,
    record: { ...input, text: '更新备注' },
  })
  await denied(
    invoke(owner, 'records_update', {
      babyId: baby.id,
      recordId: record.id,
      revision: 1,
      record: input,
    }),
  )
  await invoke(owner, 'records_delete', {
    babyId: baby.id,
    recordId: record.id,
    revision: 2,
  })
  assert.equal(
    (
      await invoke<{ records: BabyRecord[] }>(owner, 'records_list', {
        babyId: baby.id,
        trash: true,
      })
    ).records.length,
    1,
  )
  await invoke(owner, 'records_restore', {
    babyId: baby.id,
    recordId: record.id,
    revision: 3,
  })
  const creative = await files.upload(
    owner,
    'baby-diary',
    { type: 'creative', id: baby.id },
    '第一张.png',
    png,
  )
  const projectInput = {
    title: '每天一张',
    template: 'daily-photo',
    visibility: 'members',
    settings: defaultPlayback,
  }
  const project = await invoke<CreativeProject>(owner, 'projects_create', {
    babyId: baby.id,
    project: projectInput,
  })
  const frame = {
    id: randomUUID(),
    assetId: creative.id,
    date: '2026-10-01',
    caption: '小小的你',
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
  }
  await invoke(owner, 'projects_save', {
    babyId: baby.id,
    projectId: project.id,
    revision: 1,
    project: projectInput,
    frames: [frame],
  })
  assert.equal(
    (
      await invoke<{ frames: unknown[] }>(viewer, 'projects_get', {
        babyId: baby.id,
        projectId: project.id,
      })
    ).frames.length,
    1,
  )
  const second = await invoke<CreativeProject>(owner, 'projects_create', {
    babyId: baby.id,
    project: { ...projectInput, title: '另一个项目' },
  })
  await assert.rejects(
    invoke(owner, 'projects_save', {
      babyId: baby.id,
      projectId: second.id,
      revision: 1,
      project: projectInput,
      frames: [frame],
    }),
  )
  const largeFrames = Array.from({ length: 1000 }, (_, index) => ({
    ...frame,
    id: index ? randomUUID() : frame.id,
    caption: '照片说明'.repeat(40),
  }))
  assert.ok(JSON.stringify(largeFrames).length > 64000)
  assert.ok(Buffer.byteLength(JSON.stringify(largeFrames)) < 1024 * 1024)
  await invoke(owner, 'projects_save', {
    babyId: baby.id,
    projectId: project.id,
    revision: 2,
    project: projectInput,
    frames: largeFrames,
  })
  assert.equal(
    (
      await invoke<{ frames: unknown[] }>(viewer, 'projects_get', {
        babyId: baby.id,
        projectId: project.id,
      })
    ).frames.length,
    1000,
  )
  await invoke(owner, 'projects_delete', {
    babyId: baby.id,
    projectId: project.id,
    revision: 3,
  })
  assert.equal(
    (
      await invoke<CreativeProject[]>(owner, 'projects_list', {
        babyId: baby.id,
        trash: true,
      })
    ).length,
    1,
  )
  await invoke(owner, 'projects_restore', {
    babyId: baby.id,
    projectId: project.id,
    revision: 4,
  })
  assert.equal(
    (
      await invoke<{ frames: unknown[] }>(viewer, 'projects_get', {
        babyId: baby.id,
        projectId: project.id,
      })
    ).frames.length,
    1000,
  )
  // Invites consume their use count once even with concurrent joins.
  const once = await invoke<{ token: string }>(owner, 'invites_create', {
    babyId: baby.id,
    role: 'viewer',
    scopes: ['diary'],
    allowExport: false,
    days: 1,
    maxUses: 1,
  })
  const extra = await actor('亲友')
  const joins = await Promise.allSettled([
    invoke(stranger, 'invites_accept', {
      token: once.token,
      displayName: '朋友',
    }),
    invoke(extra, 'invites_accept', { token: once.token, displayName: '亲友' }),
  ])
  assert.equal(
    joins.filter((result) => result.status === 'fulfilled').length,
    1,
  )
  // Replayed write receipts must respect a later scope downgrade.
  await invoke(owner, 'members_update', {
    babyId: baby.id,
    subject: viewerSubject,
    role: 'viewer',
    scopes: ['growth'],
    allowExport: false,
  })
  await denied(files.read(viewer, 'baby-diary', photo.id))
  const module = createBabyDiaryModule({
    invoke: async () => null,
    inspect: async () => {},
  })
  assert.ok(module.tools.baby_diary_add?.resources)
  assert.equal(module.tools.baby_diary_add?.effect, 'write')
  await invoke(owner, 'members_remove', {
    babyId: baby.id,
    subject: editorSubject,
  })
  await denied(invoke(editor, 'babies_get', { babyId: baby.id }))
  // Same installation generation may update its release; a stale old release is fenced.
  const upgraded = new ApplicationPlatform(source, [updateRelease], {
    'baby-diary': 'user',
  })
  upgraded.bind('baby-diary', babyDiary.backend())
  await upgraded.initialize()
  await source
    .getRepository(ApplicationReleaseEntity)
    .update(
      { release_id: updateRelease.releaseId },
      { published: 1, status: 'published' },
    )
  const oldInstallation = (
    await applications.assertActive(owner.user.id, 'baby-diary')
  ).installation
  assert.equal(
    (
      await upgraded.change(
        owner.user.id,
        'baby-diary',
        'update',
        updateRelease.releaseId,
        randomUUID(),
        [...updateRelease.permissions],
      )
    ).status,
    'completed',
  )
  assert.equal(
    (await invoke<BabyProfile[]>(owner, 'babies_list'))[0]?.id,
    baby.id,
  )
  await denied(
    babyDiary.invoke({
      appId: 'baby-diary',
      releaseId: oldInstallation.releaseId,
      generation: oldInstallation.generation,
      subject: ownerSubject,
      invocationId: randomUUID(),
      method: 'babies_list',
      arguments: {},
    }),
  )
  const old = (await applications.assertActive(owner.user.id, 'baby-diary'))
    .installation
  await applications.change(
    owner.user.id,
    'baby-diary',
    'uninstall',
    old.releaseId,
    randomUUID(),
    [],
  )
  await denied(
    babyDiary.invoke({
      appId: 'baby-diary',
      releaseId: old.releaseId,
      generation: old.generation,
      subject: ownerSubject,
      invocationId: randomUUID(),
      method: 'babies_create',
      arguments: create,
    }),
  )
  await denied(files.read(owner, 'baby-diary', photo.id))
  // An acknowledged old install retry returns its receipt but cannot reactivate an uninstalled app.
  await babyDiary.lifecycle(
    lifecycleRequests.find(
      (request) =>
        request.subject === ownerSubject && request.action === 'install',
    )!,
  )
  await denied(
    babyDiary.invoke({
      appId: 'baby-diary',
      releaseId: old.releaseId,
      generation: old.generation,
      subject: ownerSubject,
      invocationId: randomUUID(),
      method: 'babies_list',
      arguments: {},
    }),
  )
  await applications.change(
    owner.user.id,
    'baby-diary',
    'install',
    babyDiaryRelease.releaseId,
    randomUUID(),
    [...babyDiaryRelease.permissions],
  )
  assert.equal(
    (await invoke<BabyProfile[]>(owner, 'babies_list'))[0]?.id,
    baby.id,
  )
  await files.purgeDrafts()
  process.stdout.write(
    'Baby diary integration passed: installation, permissions, private media, atomic batches, conflicts, recycle, projects, invitations and stale generations.\n',
  )
} finally {
  for (const babyId of babyIds) {
    // Only test-owned domains are removed; the disposable DB contains no real user data.
    await source.getRepository(PrivateFileEntity).delete({ scopeId: babyId })
    await source
      .getRepository(PrivateFileQuotaEntity)
      .delete({ scopeId: babyId })
    for (const table of [
      'baby_diary_frames',
      'baby_diary_projects',
      'baby_diary_records',
      'baby_diary_invites',
      'baby_diary_audit',
      'baby_diary_members',
      'baby_diary_babies',
    ]) {
      if (table === 'baby_diary_frames') {
        await source.query(
          'DELETE f FROM baby_diary_frames f JOIN baby_diary_projects p ON f.project_id=p.id WHERE p.baby_id=?',
          [babyId],
        )
      } else {
        await source.query(
          `DELETE FROM ${table} WHERE ${table === 'baby_diary_babies' ? 'id' : 'baby_id'}=?`,
          [babyId],
        )
      }
    }
  }
  for (const actor of actors) {
    const subject = applications.subject(actor.user.id, 'baby-diary')
    await source.query('DELETE FROM baby_diary_operations WHERE subject=?', [
      subject,
    ])
    await source.query('DELETE FROM baby_diary_actors WHERE subject=?', [
      subject,
    ])
  }
  await cleanupUsers(
    source,
    actors.map((actor) => actor.user.id),
  )
  await source
    .getRepository(ApplicationReleaseEntity)
    .delete({ release_id: updateRelease.releaseId })
  await source.destroy()
  await rm(directory, { recursive: true, force: true })
}
