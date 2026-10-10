import { onScopeDispose, reactive, type Ref } from "vue";
import { moveDesktopApp } from "@t-box/shared";

/** Pointer sorting uses the same interaction on mouse, touch and pen; no external drag library. */
export function useAppDrag(
  order: Ref<string[]>,
  editing: Ref<boolean>,
  canEdit: () => boolean,
  commit: (ids: string[]) => void,
) {
  const drag = reactive({ appId: "", x: 0, y: 0 });
  let press:
    | { id: number; appId: string; x: number; y: number; capture: HTMLElement }
    | undefined;
  let hold: ReturnType<typeof setTimeout> | undefined,
    before: string[] = [],
    moved = false,
    blockedUntil = 0;
  const reset = () => {
    clearTimeout(hold);
    const previous = press;
    press = undefined;
    drag.appId = "";
    if (previous?.capture.hasPointerCapture(previous.id))
      previous.capture.releasePointerCapture(previous.id);
  };
  const start = (event: PointerEvent, appId: string) => {
    if (event.button !== 0 || !canEdit()) return;
    reset();
    // Capture on the stable grid once movement starts. Reordering a keyed app
    // moves its DOM node, which would otherwise release capture mid-gesture.
    const capture = (event.currentTarget as HTMLElement).closest<HTMLElement>(
      ".desktop-grid",
    );
    if (!capture) return;
    press = {
      id: event.pointerId,
      appId,
      x: event.clientX,
      y: event.clientY,
      capture,
    };
    moved = false;
    before = [...order.value];
    if (!editing.value) {
      hold = setTimeout(() => {
        editing.value = true;
        blockedUntil = performance.now() + 600;
      }, 450);
      return;
    }
  };
  const move = (event: PointerEvent) => {
    if (!press || press.id !== event.pointerId) return;
    if (
      Math.hypot(event.clientX - press.x, event.clientY - press.y) < 7 &&
      !moved
    )
      return;
    clearTimeout(hold);
    if (!editing.value) {
      reset();
      return;
    }
    if (!press.capture.hasPointerCapture(event.pointerId))
      press.capture.setPointerCapture(event.pointerId);
    moved = true;
    drag.appId = press.appId;
    drag.x = event.clientX;
    drag.y = event.clientY;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-app-id]");
    if (target?.dataset.appId)
      order.value = moveDesktopApp(
        order.value,
        press.appId,
        target.dataset.appId,
      );
  };
  const end = (event: PointerEvent) => {
    if (!press || press.id !== event.pointerId) return;
    if (moved) {
      blockedUntil = performance.now() + 500;
      commit([...order.value]);
    }
    reset();
  };
  const cancel = () => {
    if (drag.appId) {
      order.value = [...before];
      blockedUntil = performance.now() + 500;
    }
    reset();
  };
  const consumeClick = () => performance.now() < blockedUntil;
  const lost = (event: PointerEvent) => {
    if (press && event.pointerId === press.id && event.target === press.capture)
      cancel();
  };
  const leave = () => {
    if (!editing.value) reset();
  };
  onScopeDispose(reset);
  return { drag, start, move, end, cancel, lost, leave, consumeClick };
}
