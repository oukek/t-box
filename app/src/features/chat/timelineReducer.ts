import type { ChatMessage, ChatTimelineItem } from "@t-box/shared";
/** WebSocket delivers an ordered stream; revisions also discard duplicate/stale updates. */
export function applyTimelineItem(
  message: ChatMessage,
  item: ChatTimelineItem,
) {
  const items = (message.timeline ||= []);
  const index = items.findIndex((x) => x.id === item.id);
  if (index >= 0 && items[index]!.revision >= item.revision) return;
  if (index < 0) items.push(item);
  else items[index] = item;
  items.sort((a, b) => a.sequence - b.sequence);
}
export function applyTimelineDelta(
  message: ChatMessage,
  id: string,
  revision: number,
  delta: string,
) {
  const item = message.timeline?.find((x) => x.id === id);
  if (!item || item.kind === "tool" || item.revision >= revision) return;
  // Never append a delta onto an incomplete base; the next snapshot/full update restores it.
  if (revision !== item.revision + 1) return;
  item.text += delta;
  item.revision = revision;
}
