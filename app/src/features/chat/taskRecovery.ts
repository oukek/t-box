import type { ChatSnapshot, TaskSummary } from "@t-box/shared";

/** Resume one pending UI boundary after a transport handshake; never retry user messages. */
export class ClientTaskRecovery {
  private taskId = "";
  open(snapshot: ChatSnapshot) {
    this.taskId =
      snapshot.activeRun?.id ||
      (snapshot.task &&
      ["running", "waiting_client"].includes(snapshot.task.status)
        ? snapshot.task.id
        : "");
  }
  take(task: TaskSummary | null, busy: boolean): boolean {
    if (
      busy ||
      !task ||
      task.id !== this.taskId ||
      task.status !== "waiting_client"
    )
      return false;
    this.taskId = "";
    return true;
  }
  clear() {
    this.taskId = "";
  }
}
