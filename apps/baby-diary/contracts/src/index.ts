import type { ApplicationManifest } from '@t-box/app-contracts'
import { dayjs } from '@t-box/dayjs'
import { BabyErrorCode } from './error-codes.js'
import { applicationIcon } from './icon.js'

export { BabyErrorCode } from './error-codes.js'
export const babyDiaryManifest = {
  id: 'baby-diary',
  name: '宝宝日记',
  description:
    '为每个小小的第一次，留一页成长记忆。支持多人记录、成长曲线与创意影像。',
  icon: 'heart',
  iconAsset: applicationIcon,
  color: 'green',
  version: '1.2.3',
  skillIds: ['baby-journal', 'baby-care'],
} as const satisfies ApplicationManifest
export type BabyRole = 'owner' | 'admin' | 'editor' | 'viewer'
export const babyScopes = ['diary', 'growth', 'creative', 'care'] as const
export type BabyScope = (typeof babyScopes)[number]
export type BabyVisibility = 'members' | 'managers'
export const babyThemes = ['pink', 'blue', 'neutral'] as const
export type BabyTheme = (typeof babyThemes)[number]
export const babyThemeNames: Record<BabyTheme, string> = {
  pink: '暖粉',
  blue: '浅蓝',
  neutral: '中性绿',
}
export interface BabyInput {
  name: string
  birthDate: string | null
  sex: 'unknown' | 'female' | 'male'
  timezone: string
  /** null follows sex. Omission preserves existing preferences on older clients. */
  theme?: BabyTheme | null
}
export interface BabyProfile extends BabyInput {
  theme: BabyTheme | null
  id: string
  role: BabyRole
  scopes: BabyScope[]
  allowExport: boolean
  archived: boolean
  revision: number
  createdAt: string
}
export function resolveBabyTheme(
  sex: BabyInput['sex'],
  preference?: BabyTheme | null,
): BabyTheme {
  return preference ?? (sex === 'female' ? 'pink' : sex === 'male' ? 'blue' : 'neutral')
}
export interface BabyMember {
  subject: string
  displayName: string
  role: BabyRole
  scopes: BabyScope[]
  allowExport: boolean
  joinedAt: string
}
export interface BabyInvite {
  id: string
  role: Exclude<BabyRole, 'owner'>
  scopes: BabyScope[]
  allowExport: boolean
  expiresAt: string
  maxUses: number
  uses: number
  revoked: boolean
}
export const recordKinds = ['diary', 'measurement', 'milestone'] as const
export type BabyRecordKind = (typeof recordKinds)[number]
export const milestonePresets = [
  '第一次微笑',
  '第一次翻身',
  '第一次坐起',
  '第一次爬行',
  '第一次站立',
  '第一次走路',
  '第一颗乳牙',
  '第一次叫爸爸',
  '第一次叫妈妈',
  '第一次旅行',
  '第一次画画',
] as const
export interface BabyMeasurement {
  heightMm?: number
  weightGrams?: number
  headMm?: number
  method: 'standing' | 'lying' | 'unspecified'
}
export interface BabyRecordInput {
  kind: BabyRecordKind
  date: string
  title: string
  text: string
  tags: string[]
  assetIds: string[]
  visibility: BabyVisibility
  measurement: BabyMeasurement | null
}
export interface BabyRecord extends BabyRecordInput {
  id: string
  babyId: string
  author: string
  authorName: string
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
export type GrowthRecord = Pick<
  BabyRecord,
  'id' | 'date' | 'measurement' | 'deletedAt' | 'createdAt'
>
export const creativeTemplates = [
  {
    id: 'daily-photo',
    title: '每天一张',
    description: '同一个姿势，看见每天的变化',
  },
  { id: 'monthly', title: '每月留影', description: '把每个月龄串成一段时光' },
  {
    id: 'same-object',
    title: '和玩偶一起长大',
    description: '留一个不变的参照物',
  },
  {
    id: 'little-details',
    title: '小手小脚',
    description: '记住那些小小的细节',
  },
  {
    id: 'firsts',
    title: '第一次合集',
    description: '珍藏一个个值得纪念的瞬间',
  },
  {
    id: 'artwork',
    title: '小小艺术家',
    description: '画作与手工，也在慢慢长大',
  },
] as const
export type CreativeTemplate = (typeof creativeTemplates)[number]['id']
export interface PlaybackSettings {
  transition: 'cut' | 'fade' | 'slide' | 'zoom'
  frameMs: number
  transitionMs: number
  loop: boolean
  reverse: boolean
  aspect: '3:4' | '1:1' | '16:9'
  overlay: 'date' | 'age' | 'none'
}
export const defaultPlayback: PlaybackSettings = {
  transition: 'fade',
  frameMs: 1200,
  transitionMs: 350,
  loop: true,
  reverse: false,
  aspect: '3:4',
  overlay: 'age',
}
export interface CreativeFrame {
  id: string
  assetId: string
  date: string
  caption: string
  x: number
  y: number
  scale: number
  rotation: number
}
export interface CreativeProjectInput {
  title: string
  template: CreativeTemplate
  visibility: BabyVisibility
  settings: PlaybackSettings
}
export interface CreativeProject extends CreativeProjectInput {
  id: string
  babyId: string
  author: string
  revision: number
  frameCount: number
  createdAt: string
  deletedAt: string | null
}
export interface BabySnapshot {
  baby: BabyProfile
  records: BabyRecord[]
  projects: CreativeProject[]
  totalRecords: number
}
export interface BabyAsset {
  id: string
  name: string
  mimeType: string
  size: number
  source: 'uploaded' | 'generated'
  createdAt: string
}
export const scopeForRecord = (kind: BabyRecordKind): BabyScope =>
  kind === 'measurement' ? 'growth' : 'diary'
export const mediaScope = (scope: BabyScope, visibility: BabyVisibility) =>
  visibility === 'managers' ? `private-${scope}` : scope
export function object(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  ) {
    throw BabyErrorCode.BABY_INVALID_INPUT('参数结构不正确')
  }
  return value as Record<string, unknown>
}
export function text(
  value: unknown,
  label: string,
  max = 200,
  required = true,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  ) {
    throw BabyErrorCode.BABY_INVALID_INPUT(
      `${label}${required ? '不能为空且' : ''}最多 ${max} 个字符`,
    )
  }
  return value.trim()
}
export function id(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  ) {
    throw BabyErrorCode.BABY_INVALID_INPUT('标识无效')
  }
  return value.toLowerCase()
}
export function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !dayjs.utc(value, 'YYYY-MM-DD', true).isValid() ||
    value < '1900-01-01' ||
    value > '2199-12-31'
  ) {
    throw BabyErrorCode.BABY_INVALID_INPUT('日期无效')
  }
  return value
}
export function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    throw BabyErrorCode.BABY_INVALID_INPUT(
      `${label}应为 ${min} 至 ${max} 的整数`,
    )
  }
  return Number(value)
}
export function visibility(value: unknown): BabyVisibility {
  if (value !== 'members' && value !== 'managers') {
    throw BabyErrorCode.BABY_INVALID_INPUT('请选择可见范围')
  }
  return value
}
export function parseScopes(value: unknown): BabyScope[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > babyScopes.length ||
    value.some((x) => !babyScopes.includes(x)) ||
    new Set(value).size !== value.length
  ) {
    throw BabyErrorCode.BABY_INVALID_INPUT('请至少选择一个可访问范围')
  }
  return value as BabyScope[]
}
export function parseBaby(value: unknown): BabyInput {
  const v = object(value, ['name', 'birthDate', 'sex', 'timezone', 'theme'])
  const name = text(v.name, '昵称', 40)
  const birthDate =
    v.birthDate == null || v.birthDate === '' ? null : date(v.birthDate)
  if (!['unknown', 'female', 'male'].includes(String(v.sex))) {
    throw BabyErrorCode.BABY_INVALID_INPUT('性别无效')
  }
  const timezone = text(v.timezone, '时区', 80)
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
  } catch {
    throw BabyErrorCode.BABY_INVALID_INPUT('时区无效')
  }
  if (birthDate && birthDate > dayjs().tz(timezone).format('YYYY-MM-DD')) {
    throw BabyErrorCode.BABY_INVALID_INPUT('出生日期不能晚于今天')
  }
  if (v.theme !== undefined && v.theme !== null && !babyThemes.includes(v.theme as BabyTheme)) {
    throw BabyErrorCode.BABY_INVALID_INPUT('请选择粉色、浅蓝或中性绿主题')
  }
  return {
    name,
    birthDate,
    sex: v.sex as BabyInput['sex'],
    timezone,
    ...(v.theme !== undefined ? { theme: v.theme as BabyTheme | null } : {}),
  }
}
export function parseRecord(value: unknown): BabyRecordInput {
  const v = object(value, [
    'kind',
    'date',
    'title',
    'text',
    'tags',
    'assetIds',
    'visibility',
    'measurement',
  ])
  if (!recordKinds.includes(v.kind as BabyRecordKind)) {
    throw BabyErrorCode.BABY_INVALID_INPUT('记录类型无效')
  }
  const kind = v.kind as BabyRecordKind
  const title = text(v.title, '标题', 100, kind !== 'measurement')
  if (!Array.isArray(v.tags) || v.tags.length > 10) {
    throw BabyErrorCode.BABY_INVALID_INPUT('最多添加 10 个标签')
  }
  const tags = [...new Set(v.tags.map((x) => text(x, '标签', 20)))]
  if (!Array.isArray(v.assetIds) || v.assetIds.length > 20) {
    throw BabyErrorCode.BABY_INVALID_INPUT('每条记录最多 20 个附件')
  }
  const assetIds = [...new Set(v.assetIds.map(id))]
  let measurement: BabyMeasurement | null = null
  if (kind === 'measurement') {
    const m = object(v.measurement, [
      'heightMm',
      'weightGrams',
      'headMm',
      'method',
    ])
    if (!['standing', 'lying', 'unspecified'].includes(String(m.method))) {
      throw BabyErrorCode.BABY_INVALID_INPUT('测量方式无效')
    }
    measurement = { method: m.method as BabyMeasurement['method'] }
    if (m.heightMm != null) {
      measurement.heightMm = integer(
        m.heightMm,
        '身长/身高（毫米）',
        100,
        2500,
      )
    }
    if (m.weightGrams != null) {
      measurement.weightGrams = integer(
        m.weightGrams,
        '体重（克）',
        100,
        200000,
      )
    }
    if (m.headMm != null) {
      measurement.headMm = integer(m.headMm, '头围（毫米）', 100, 1000)
    }
    if (Object.keys(measurement).length < 2) {
      throw BabyErrorCode.BABY_INVALID_INPUT('请至少填写一项测量数据')
    }
  } else if (v.measurement != null) {
    throw BabyErrorCode.BABY_INVALID_INPUT('此记录类型不能携带测量数据')
  }
  return {
    kind,
    date: date(v.date),
    title,
    text: text(v.text, '正文', 10000, false),
    tags,
    assetIds,
    visibility: visibility(v.visibility),
    measurement,
  }
}
export function parsePlayback(value: unknown): PlaybackSettings {
  const v = object(value, [
    'transition',
    'frameMs',
    'transitionMs',
    'loop',
    'reverse',
    'aspect',
    'overlay',
  ])
  if (
    !['cut', 'fade', 'slide', 'zoom'].includes(String(v.transition)) ||
    !['3:4', '1:1', '16:9'].includes(String(v.aspect)) ||
    !['date', 'age', 'none'].includes(String(v.overlay)) ||
    typeof v.loop !== 'boolean' ||
    typeof v.reverse !== 'boolean'
  ) {
    throw BabyErrorCode.BABY_INVALID_INPUT('播放设置无效')
  }
  const frameMs = integer(v.frameMs, '每张停留时间（毫秒）', 40, 10000)
  const transitionMs = integer(v.transitionMs, '转场时间（毫秒）', 0, frameMs)
  return {
    transition: v.transition as PlaybackSettings['transition'],
    frameMs,
    transitionMs,
    loop: v.loop,
    reverse: v.reverse,
    aspect: v.aspect as PlaybackSettings['aspect'],
    overlay: v.overlay as PlaybackSettings['overlay'],
  }
}
export function parseProject(value: unknown): CreativeProjectInput {
  const v = object(value, ['title', 'template', 'visibility', 'settings'])
  if (!creativeTemplates.some((x) => x.id === v.template)) {
    throw BabyErrorCode.BABY_INVALID_INPUT('创意模板无效')
  }
  return {
    title: text(v.title, '项目名称', 60),
    template: v.template as CreativeTemplate,
    visibility: visibility(v.visibility),
    settings: parsePlayback(v.settings),
  }
}
export function parseFrames(value: unknown): CreativeFrame[] {
  if (!Array.isArray(value) || value.length > 1000) {
    throw BabyErrorCode.BABY_FRAME_LIMIT()
  }
  const frames = value.map((input): CreativeFrame => {
    const v = object(input, [
      'id',
      'assetId',
      'date',
      'caption',
      'x',
      'y',
      'scale',
      'rotation',
    ])
    for (const [key, min, max] of [
      ['x', -50, 50],
      ['y', -50, 50],
      ['scale', 1, 3],
      ['rotation', -20, 20],
    ] as const) {
      if (
        typeof v[key] !== 'number' ||
        !Number.isFinite(v[key]) ||
        v[key] < min ||
        v[key] > max
      ) {
        throw BabyErrorCode.BABY_INVALID_INPUT('照片对齐参数无效')
      }
    }
    return {
      id: id(v.id),
      assetId: id(v.assetId),
      date: date(v.date),
      caption: text(v.caption, '照片说明', 200, false),
      x: v.x as number,
      y: v.y as number,
      scale: v.scale as number,
      rotation: v.rotation as number,
    }
  })
  if (new Set(frames.map((x) => x.id)).size !== frames.length) {
    throw BabyErrorCode.BABY_INVALID_INPUT('照片帧不能重复')
  }
  return frames
}
export function parseBabyParams(value: unknown): Record<string, string> {
  if (value == null) {
    return {}
  }
  const v = object(value, ['babyId', 'tab', 'invite'])
  const result: Record<string, string> = {}
  if (v.babyId) {
    result.babyId = id(v.babyId)
  }
  if (v.tab != null) {
    if (!['care', 'statistics', 'records', 'growth', 'creative'].includes(String(v.tab))) {
      throw BabyErrorCode.BABY_INVALID_INPUT('页面无效')
    }
    result.tab = String(v.tab)
  }
  if (v.invite) {
    result.invite = text(v.invite, '邀请码', 128)
  }
  return result
}
