import type { MarketEntry } from '@t-box/app-contracts'
import type { DeepReadonly } from 'vue'
import { presentApplication } from '@t-box/app-shell-sdk'

export type MarketApp = DeepReadonly<MarketEntry>
export type MarketFilter = 'all' | 'installed' | 'updates'
export const displayApp = (entry: MarketApp) => presentApplication(entry.release.manifest)
export const isInstalled = (entry: MarketApp) => entry.installation?.status === 'active'
export const hasUpdate = (entry: MarketApp) => isInstalled(entry) && entry.installation!.releaseId !== entry.release.releaseId
export const isProcessing = (entry: MarketApp) => entry.installation?.status === 'installing' || Boolean(entry.installation?.operationId && entry.installation.status !== 'failed' && entry.installation.status !== 'revoked')
export const installAction = (entry: MarketApp) => hasUpdate(entry) ? 'update' : isInstalled(entry) ? 'uninstall' : 'install'
export const actionLabel = (entry: MarketApp) => isProcessing(entry) ? '处理中' : hasUpdate(entry) ? '更新' : isInstalled(entry) ? '打开' : entry.installation?.status === 'failed' ? '重新安装' : '安装'
export const stateLabel = (entry: MarketApp) => isProcessing(entry) ? '正在处理' : hasUpdate(entry) ? '有新版本' : isInstalled(entry) ? '已安装' : entry.installation?.status === 'failed' ? '安装未完成' : '未安装'
export const matchesFilter = (entry: MarketApp, filter: MarketFilter) => filter === 'installed' ? isInstalled(entry) : filter === 'updates' ? hasUpdate(entry) : true

const permissions: Record<string, string> = {
  'calculator.calculate': '执行数学计算',
  'storage': '保存应用偏好与本地记录',
  'api.request': '访问本应用的数据',
  'files': '上传与读取你选择的文件',
  'files.private': '按应用内权限访问私有照片和附件',
  'resources.bindings': '关联本应用中的资源',
  'device.reminders': '同步设备提醒',
  'events.books': '接收账本变更通知',
  'profile.read': '读取你的昵称',
}
export const permissionLabel = (permission: string) => permissions[permission] || permission
/** Keep every executable grant intact; summarize app-owned methods without leaking RPC names into consent UI. */
export function permissionItems(entry: MarketApp) {
  return [...new Set(entry.release.permissions.map((permission) => permissions[permission] || (permission.startsWith(`${entry.release.appId}.`) ? `访问「${entry.release.manifest.name}」内的数据与功能` : permission.startsWith('events.') ? '接收本应用的数据变更通知' : permission)))]
}
