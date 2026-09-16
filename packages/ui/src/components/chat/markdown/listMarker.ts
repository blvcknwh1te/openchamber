/**
 * Numeric list-marker grammar shared by the composer highlighter and the
 * Markdown renderer.
 *
 * CommonMark reads a single number followed by `.` or `)` as an ordered-list
 * marker and leaves a dotted, multi-level number (`1.2)`, `1.1.`, `2.3.4)`) as
 * paragraph text. Both surfaces classify such a line as a list item anyway, so
 * the author's numbering reads as a list without the browser renumbering it.
 *
 * The grammar lives here so the two consumers cannot drift apart.
 */

/** Bullet markers: `-`, `*`, `+`. */
const BULLET_MARKER_SOURCE = '[-*+]';

/** Single-level ordered markers: `1.`, `2)`. */
const ORDERED_MARKER_SOURCE = '\\d{1,9}[.)]';

/** Multi-level numeric markers: `1.1.`, `1.2)`, `2.3.4)`. */
export const MULTILEVEL_MARKER_SOURCE = '\\d{1,9}(?:\\.\\d{1,9})+(?:\\.|\\))';

/**
 * Every marker the composer dims as a list marker. The multi-level form is
 * listed before the single-level one so the longer, more specific match wins.
 */
export const LIST_MARKER_SOURCE = [
  BULLET_MARKER_SOURCE,
  MULTILEVEL_MARKER_SOURCE,
  ORDERED_MARKER_SOURCE,
].join('|');

/** One item of a multi-level numeric list. */
interface MultilevelListItem {
  /** The marker exactly as written, e.g. `1.2)`. */
  marker: string;
  /** Item content; continuation lines are joined with `\n`. */
  text: string;
}

interface MultilevelList {
  /** Consumed prefix of the source; the caller advances by exactly this much. */
  raw: string;
  items: MultilevelListItem[];
}

const ITEM_RE = new RegExp(`^[ \\t]{0,3}(${MULTILEVEL_MARKER_SOURCE})[ \\t]+(.*)$`);

/**
 * A line opening another block construct. Such a line ends the list instead of
 * continuing the previous item.
 */
const NEXT_BLOCK_RE = new RegExp(
  `^[ \\t]{0,3}(?:\`{3,}|~{3,}|#{1,6}[ \\t]|>|(?:${LIST_MARKER_SOURCE})[ \\t]|-{3,}[ \\t]*$|(?:_{3,}|\\*{3,})[ \\t]*$)`,
);

/**
 * Read a leading run of multi-level numeric list items from `src`, or null when
 * none opens it. A following non-blank line that does not open another block
 * stays the previous item's continuation, the way a list paragraph continues.
 */
export const parseMultilevelList = (src: string): MultilevelList | null => {
  const items: MultilevelListItem[] = [];
  let consumed = 0;
  let cursor = 0;

  while (cursor < src.length) {
    const lineBreak = src.indexOf('\n', cursor);
    const lineEnd = lineBreak === -1 ? src.length : lineBreak;
    const line = src.slice(cursor, lineEnd);
    const nextCursor = lineBreak === -1 ? src.length : lineBreak + 1;

    const item = ITEM_RE.exec(line);
    if (item) {
      items.push({ marker: item[1], text: item[2] });
      consumed = nextCursor;
      cursor = nextCursor;
      continue;
    }

    if (items.length === 0) return null;
    if (line.trim().length === 0 || NEXT_BLOCK_RE.test(line)) break;

    const last = items[items.length - 1];
    last.text += `\n${line}`;
    consumed = nextCursor;
    cursor = nextCursor;
  }

  if (items.length === 0) return null;
  return { raw: src.slice(0, consumed), items };
};
