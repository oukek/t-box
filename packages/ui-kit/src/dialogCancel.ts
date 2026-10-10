/** File inputs also emit a bubbling cancel event when their native picker closes. */
export function handleDialogCancel(
  event: Event,
  dialog: HTMLDialogElement | undefined,
  busy: boolean | undefined,
  close: () => void,
) {
  if (event.target !== dialog) return;
  event.preventDefault();
  if (!busy) close();
}
