import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

const { isOnText, shouldStartPan } = await import('./tableViewerPan');

describe('isOnText', () => {
  let windowInstance: Window;

  beforeEach(() => {
    windowInstance = new Window();
    Object.assign(globalThis, {
      window: windowInstance,
      document: windowInstance.document,
      HTMLElement: windowInstance.HTMLElement,
      Node: windowInstance.Node,
    });
  });

  afterEach(async () => {
    await windowInstance.happyDOM.close();
  });

  // happy-dom has no caret probe, so the API is injected to exercise the check.
  const withCaretNode = (node: Node | null, run: () => void) => {
    const doc = document as Document & { caretRangeFromPoint?: unknown };
    doc.caretRangeFromPoint = () =>
      (node ? ({ startContainer: node } as unknown as Range) : null);
    try {
      run();
    } finally {
      Object.assign(doc, { caretRangeFromPoint: undefined });
    }
  };

  test('reports text inside a cell', () => {
    const cell = document.createElement('td');
    const text = document.createTextNode('some value');
    cell.append(text);

    withCaretNode(text, () => expect(isOnText(10, 10)).toBe(true));
  });

  test('ignores a point outside any cell', () => {
    const paragraph = document.createElement('p');
    const text = document.createTextNode('outside');
    paragraph.append(text);

    withCaretNode(text, () => expect(isOnText(10, 10)).toBe(false));
  });

  test('ignores blank nodes and empty hits', () => {
    const cell = document.createElement('td');
    const blank = document.createTextNode('   ');
    cell.append(blank);

    withCaretNode(blank, () => expect(isOnText(10, 10)).toBe(false));
    withCaretNode(null, () => expect(isOnText(10, 10)).toBe(false));
  });
});

describe('shouldStartPan', () => {
  const press = (overrides: Partial<Parameters<typeof shouldStartPan>[0]> = {}) => ({
    button: 0,
    ctrlKey: false,
    metaKey: false,
    overText: false,
    ...overrides,
  });

  test('pans with the middle button even over cell text', () => {
    expect(shouldStartPan(press({ button: 1, overText: true }))).toBe(true);
  });

  test('pans with Ctrl or Cmd and the left button over cell text', () => {
    expect(shouldStartPan(press({ overText: true, ctrlKey: true }))).toBe(true);
    expect(shouldStartPan(press({ overText: true, metaKey: true }))).toBe(true);
  });

  test('leaves a plain left press on cell text to the browser', () => {
    expect(shouldStartPan(press({ overText: true }))).toBe(false);
  });

  test('pans with a plain left press on the padding', () => {
    expect(shouldStartPan(press({ overText: false }))).toBe(true);
  });

  test('ignores the right button', () => {
    expect(shouldStartPan(press({ button: 2 }))).toBe(false);
    expect(shouldStartPan(press({ button: 2, overText: true }))).toBe(false);
  });
});
