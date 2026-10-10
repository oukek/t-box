let count = 0,
  previous = "";
/** Nested selectors keep the document locked until the final sheet closes. */
export function lockDocumentScroll() {
  if (count++ === 0) {
    previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--count === 0) document.body.style.overflow = previous;
  };
}
