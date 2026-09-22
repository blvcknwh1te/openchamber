/**
 * True when the point lands on rendered text inside a table cell. Markdown
 * renders cells as element nodes, so the caret probe is what distinguishes the
 * glyphs from the padding around them. Chromium exposes caretRangeFromPoint and
 * Firefox exposes caretPositionFromPoint, so both are tried.
 */
export const isOnText = (clientX: number, clientY: number): boolean => {
  const node = resolveCaretNode(clientX, clientY);
  if (!node || node.nodeType !== Node.TEXT_NODE || (node.textContent ?? '').trim() === '') {
    return false;
  }

  const parent = node.parentElement;
  return parent !== null && parent.closest('td, th') !== null;
};

const resolveCaretNode = (clientX: number, clientY: number): Node | null => {
  const rangeProbe = document.caretRangeFromPoint?.(clientX, clientY);
  if (rangeProbe) return rangeProbe.startContainer;

  const positionProbe = (document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
  }).caretPositionFromPoint?.(clientX, clientY);
  return positionProbe?.offsetNode ?? null;
};

/**
 * Decides whether a press starts panning the table. The middle button and
 * Ctrl/Cmd with the left button pan from anywhere. A plain left press on text
 * inside a cell is left to the browser so the text stays selectable and links
 * keep working; on padding it pans.
 */
export const shouldStartPan = (press: {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  overText: boolean;
}): boolean => {
  const isMiddleButton = press.button === 1;
  if (!isMiddleButton && press.button !== 0) return false;

  if (isMiddleButton || press.ctrlKey || press.metaKey) return true;
  return !press.overText;
};
