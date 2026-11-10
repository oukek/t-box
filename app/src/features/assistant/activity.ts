export interface AssistantActivity {
  id: string
  status: string
  busy: boolean
}

/** Quiet, assistant-local attention: progress never creates a system message or a toast. */
export class AssistantActivityIndicator {
  private previous: AssistantActivity | null = null
  private unread = false

  reset() {
    this.previous = null
    this.unread = false
  }

  observe(current: AssistantActivity, visible: boolean) {
    const changed = this.previous?.id !== current.id || this.previous?.status !== current.status
    if (visible) {
      this.unread = false
    } else if (current.id && changed && (
      ['waiting_client', 'paused', 'needs_review'].includes(current.status) ||
      (this.previous?.id === current.id && current.status === 'completed')
    )) {
      this.unread = true
    } else if (this.previous?.busy && !current.busy && current.status !== 'cancelled') {
      this.unread = true
    }
    this.previous = { ...current }
    return this.unread
  }
}
