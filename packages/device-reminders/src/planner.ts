import type { ReminderItem } from "@t-box/shared";
export interface PlannedReminder extends ReminderItem {
  id: number;
}
export interface ReminderPlan {
  owner: string;
  notifications: PlannedReminder[];
}
/** Stable IDs and differential updates preserve imminent alarms while refreshing. */
export function planReminders(
  owner: string,
  items: readonly ReminderItem[],
  previous: ReminderPlan,
  pending: readonly number[],
  now: number,
) {
  const future = items
    .filter(
      (item) =>
        Number.isFinite(Date.parse(item.at)) && Date.parse(item.at) > now,
    )
    .sort((a, b) => a.at.localeCompare(b.at));
  const unique = [...new Map(future.map((item) => [item.key, item])).values()],
    selected = unique.slice(0, 48),
    used = new Set<number>();
  const notifications = selected.map((item) => {
    let id =
      previous.owner === owner
        ? previous.notifications.find((n) => n.key === item.key)?.id
        : undefined;
    if (id === undefined) {
      let hash = 2166136261;
      for (const char of item.key)
        hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      id = 1900000000 + ((hash >>> 0) % 100000000);
    }
    while (used.has(id)) id = 1900000000 + ((id - 1900000000 + 1) % 100000000);
    used.add(id);
    return { ...item, id };
  });
  const signature = (n: PlannedReminder) =>
    JSON.stringify([n.key, n.at, n.title, n.body, n.destination]);
  const cancel = previous.notifications
    .filter(
      (old) =>
        previous.owner !== owner ||
        !notifications.some(
          (n) => n.id === old.id && signature(n) === signature(old),
        ),
    )
    .map((n) => n.id);
  const schedule = notifications.filter(
    (n) =>
      previous.owner !== owner ||
      !pending.includes(n.id) ||
      !previous.notifications.some(
        (old) => old.id === n.id && signature(old) === signature(n),
      ),
  );
  return {
    plan: { owner, notifications },
    cancel,
    schedule,
    truncated: unique.length > 48,
  };
}
