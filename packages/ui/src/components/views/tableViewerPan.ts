/**
 * Decides where a press lands on the table viewer surface and whether it starts
 * a pan.
 *
 * The surface has two regions: the table itself and the surround around it. The
 * distinction is the element under the pointer, not the glyph under it: markdown
 * renders a cell as a box with padding, so probing for the caret node treated the
 * gap between two words as free space and let a press there start a drag while a
 * press on a word started a selection. Both regions are now classified by the
 * table subtree alone, which is a check that cannot flip between two presses a
 * pixel apart.
 *
 * The surround always pans: there is nothing there to select. Inside the table a
 * plain left press stays with the browser, so cell text can be selected and links
 * keep working, while Ctrl, Cmd, or the middle button turn any press into a pan.
 */

/** The two regions of the viewer surface a press can land in. */
type PanArea = 'table' | 'surround';

/**
 * Classifies a press by the element under the pointer. Anything inside the
 * rendered table counts as the table; everything else on the surface belongs to
 * the surround. A pointer event can land on a text node, so the owning element
 * is taken from it rather than requiring an element target.
 */
export const panAreaOf = (target: EventTarget | null): PanArea => {
  const node = target as Node | null;
  if (!node) return 'surround';

  const element = node.nodeType === 1 ? (node as unknown as Element) : node.parentElement;
  return element?.closest?.('table') ? 'table' : 'surround';
};

/**
 * True when the press should start panning the table. The middle button and
 * Ctrl/Cmd with the left button pan from anywhere, including from cell text. A
 * plain left press pans only from the surround, so a press on the table stays a
 * text selection.
 */
export const shouldStartPan = (press: {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  area: PanArea;
}): boolean => {
  const isMiddleButton = press.button === 1;
  if (!isMiddleButton && press.button !== 0) return false;

  if (isMiddleButton || press.ctrlKey || press.metaKey) return true;
  return press.area === 'surround';
};
