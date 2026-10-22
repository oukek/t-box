export const taskLabels: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  paused: '已暂停',
  waiting_client: '等待前端',
  needs_review: '待核对',
  completed: '已完成',
  cancelled: '已结束',
}
export const callLabels: Record<string, string> = {
  queued: '排队中',
  running: '请求中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '执行中断',
}
export const purposeLabels: Record<string, string> = {
  response: '生成回复',
  analysis: '执行分析',
  planning: '分析计划',
  verification: '结果核对',
  compaction: '上下文整理',
  memory_extraction: '记忆候选提取',
  title: '会话标题',
  image: '图片处理',
}
export const billingLabels: Record<string, string> = { reserved: '预留中', review: '用量待核对', settled: '已结算', released: '已释放' }
export const time = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
export const duration = (value: number | null) => value == null ? '—' : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} 秒`
export const pretty = (value: unknown) => value == null ? '暂无记录' : JSON.stringify(value, null, 2)
