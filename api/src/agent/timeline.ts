import type {
  ChatMessage,
  ChatTimelineItem,
  TimelineTextKind,
  TimelineTextStatus,
  ToolCallView,
} from '@t-box/shared'
import type { ChatSession } from '../chat/session.js'

/** One ordered public projection per assistant turn; tool status updates retain their original position. */
export class MessageTimeline {
  constructor(
    private readonly session: ChatSession,
    private readonly runId: string,
    private readonly message: ChatMessage,
    private readonly agent?: { id: string, title: string },
  ) {}

  private base(id: string) {
    const items = (this.message.timeline ||= [])
    return {
      id,
      sequence: Math.max(0, ...items.map((x) => x.sequence)) + 1,
      revision: 0,
      createdAt: new Date().toISOString(),
      agentId: this.agent?.id,
      agentTitle: this.agent?.title,
    }
  }

  private publish(item: ChatTimelineItem) {
    this.session.send?.({
      type: 'timeline.update',
      runId: this.runId,
      messageId: this.message.id,
      item: structuredClone(item),
    })
  }

  text(
    id: string,
    kind: TimelineTextKind,
    text: string,
    delta = true,
    label?: string,
  ) {
    let item = this.message.timeline?.find((x) => x.id === id)
    if (!item) {
      item = { ...this.base(id), kind, text: '', status: 'streaming', label }
      this.message.timeline!.push(item)
      this.publish(item)
    }
    if (item.kind === 'tool') {
      throw new Error('Timeline item type conflict')
    }
    const nextText = delta ? item.text + text : text
    const total = (this.message.timeline || []).reduce(
      (n, x) => n + (x.kind === 'tool' || x.id === id ? 0 : x.text.length),
      0,
    )
    // Reserve room for a bounded interruption notice even when model output exhausted its budget.
    if (
      nextText.length > (kind === 'notice' ? 1000 : 80_000) ||
      (kind !== 'notice' && total + nextText.length > 400_000)
    ) {
      throw new Error('Public timeline output limit')
    }
    if (delta) {
      if (!text) {
        return
      }
      item.text += text
      item.revision++
      this.session.send?.({
        type: 'timeline.delta',
        runId: this.runId,
        messageId: this.message.id,
        itemId: id,
        revision: item.revision,
        delta: text,
      })
    } else if (item.text !== text || item.kind !== kind) {
      item.text = text
      item.kind = kind
      item.revision++
      this.publish(item)
    }
  }

  finishText(
    id: string,
    kind?: TimelineTextKind,
    status: TimelineTextStatus = 'completed',
  ) {
    const item = this.message.timeline?.find((x) => x.id === id)
    if (!item || item.kind === 'tool') {
      return
    }
    if (kind) {
      item.kind = kind
    }
    item.status = status
    item.revision++
    this.publish(item)
  }

  tool(tool: ToolCallView) {
    const id = `tool:${tool.id}`
    let item = this.message.timeline?.find((x) => x.id === id)
    if (!item) {
      item = { ...this.base(id), kind: 'tool', tool: { ...tool } }
      this.message.timeline!.push(item)
    } else {
      if (item.kind !== 'tool') {
        throw new Error('Timeline item type conflict')
      }
      item.tool = { ...tool }
      item.revision++
    }
    this.publish(item)
  }

  interrupt() {
    for (const item of this.message.timeline || []) {
      if (item.kind !== 'tool' && item.status === 'streaming') {
        this.finishText(item.id, undefined, 'interrupted')
      }
    }
  }
}
