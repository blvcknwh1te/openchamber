import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The real renderer pulls in Vite-only worker imports, which the test runner
// cannot resolve; the view under test only needs a markdown-shaped child.
import { mock } from 'bun:test';
mock.module('@/components/chat/MarkdownRenderer', () => ({
  SimpleMarkdownRenderer: ({ content }: { content: string }) => <div data-content={content} />,
}));

const { TABLE_VIEWER_SCALE, zoomTableAtPointer } = await import('./tableViewerConstants');
const { TableViewerView, isOnText } = await import('./TableViewerView');

const WIDE_TABLE = [
  '| one | two | three | four | five | six | seven | eight |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |',
].join('\n');

describe('TableViewerView', () => {
  let windowInstance: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    windowInstance = new Window();
    Object.assign(globalThis, {
      window: windowInstance,
      document: windowInstance.document,
      HTMLElement: windowInstance.HTMLElement,
      Node: windowInstance.Node,
      ResizeObserver: windowInstance.ResizeObserver,
      IS_REACT_ACT_ENVIRONMENT: true,
    });

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    await windowInstance.happyDOM.close();
  });

  const render = (markdown: string | null) =>
    act(async () => {
      root.render(<TableViewerView markdown={markdown} />);
    });

  // The content element carries the applied scale as `zoom`, which is what keeps
  // the text sharp; the transform only centers and pans.
  const getContent = () => {
    const content = container.querySelector<HTMLDivElement>('div[style*="zoom"]');
    if (!content) throw new Error('content container was not rendered');
    return content;
  };

  const getScale = () => {
    const value = Number.parseFloat(getContent().style.zoom);
    if (Number.isNaN(value)) throw new Error(`no zoom applied: "${getContent().style.zoom}"`);
    return value;
  };

  // The fit effect re-runs when the markdown changes and reads the geometry at
  // that moment, so the values are patched before a render.
  const renderFitted = async (
    markdown: string,
    available: number,
    natural: { width: number; height: number },
  ) => {
    await render(markdown);
    const content = getContent();
    const viewport = content.parentElement;
    if (!viewport) throw new Error('viewport was not rendered');
    Object.defineProperty(viewport, 'clientWidth', { value: available, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: available, configurable: true });
    Object.defineProperty(windowInstance.HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: HTMLElement) {
        return this === viewport
          ? new windowInstance.DOMRect(0, 0, available, available)
          : new windowInstance.DOMRect(0, 0, natural.width, natural.height);
      },
    });
    await render(`${markdown}\n`);
    return getContent();
  };

  test('renders nothing without markdown', async () => {
    await render(null);

    expect(container.innerHTML).toBe('');
  });

  test('fits a wide table down to the panel width', async () => {
    await renderFitted(WIDE_TABLE, 400, { width: 1200, height: 100 });

    expect(getScale()).toBeCloseTo(400 / 1200, 5);
  });

  test('never fits below the configured minimum scale', async () => {
    await renderFitted(WIDE_TABLE, 100, { width: 4000, height: 100 });

    expect(getScale()).toBeCloseTo(TABLE_VIEWER_SCALE.min, 5);
  });

  test('enlarges a small table to fill the panel', async () => {
    await renderFitted(WIDE_TABLE, 800, { width: 400, height: 100 });

    expect(getScale()).toBeCloseTo(2, 5);
  });

  test('fills the tighter axis when the table is taller than it is wide', async () => {
    await renderFitted(WIDE_TABLE, 800, { width: 100, height: 200 });

    // Both axes would allow 4x, so the configured maximum is what bounds it.
    expect(getScale()).toBeCloseTo(TABLE_VIEWER_SCALE.max, 5);
  });

  test('scales layout with zoom so text stays sharp', async () => {
    await renderFitted(WIDE_TABLE, 800, { width: 400, height: 100 });

    // A transform scale would rasterize the text once and blur it on the way up,
    // so the applied zoom must live on the layout property and the transform
    // must be limited to centering and panning.
    expect(getContent().style.transform).not.toContain('scale(');
    expect(getContent().style.zoom).not.toBe('');
  });

  test('centers the table and keeps pieces aligned while panning', async () => {
    await renderFitted(WIDE_TABLE, 800, { width: 400, height: 100 });

    const transform = getContent().style.transform;
    expect(transform).toContain('translate(-50%, -50%)');
  });
});

describe('isOnText', () => {
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

describe('zoomTableAtPointer', () => {
  test('zooms in on an upward notch', () => {
    const result = zoomTableAtPointer({
      currentScale: 1,
      deltaY: -100,
      pointerX: 0,
      pointerY: 0,
      originX: 0,
      originY: 0,
    });

    expect(result?.scale).toBeCloseTo(1 + TABLE_VIEWER_SCALE.wheelStep, 5);
  });

  test('clamps zoom in at the configured maximum', () => {
    const result = zoomTableAtPointer({
      currentScale: TABLE_VIEWER_SCALE.max,
      deltaY: -100,
      pointerX: 0,
      pointerY: 0,
      originX: 0,
      originY: 0,
    });

    expect(result).toBeNull();
  });

  test('clamps zoom out at the configured minimum', () => {
    let scale = 1;
    for (let notch = 0; notch < 100; notch += 1) {
      const result = zoomTableAtPointer({
        currentScale: scale,
        deltaY: 100,
        pointerX: 0,
        pointerY: 0,
        originX: 0,
        originY: 0,
      });
      if (!result) break;
      scale = result.scale;
    }

    expect(scale).toBeCloseTo(TABLE_VIEWER_SCALE.min, 5);
  });

  test('keeps the point under the pointer fixed while zooming', () => {
    const currentScale = 1;
    const originX = -40;
    const originY = -15;
    const pointerX = 100;
    const pointerY = 50;

    const result = zoomTableAtPointer({
      currentScale,
      deltaY: -100,
      pointerX,
      pointerY,
      originX,
      originY,
    });
    if (!result) throw new Error('the zoom step must apply');

    // Screen position of the content point under the cursor, before and after.
    const contentX = (pointerX - originX) / currentScale;
    const contentY = (pointerY - originY) / currentScale;
    expect(contentX * result.scale + result.x).toBeCloseTo(pointerX, 5);
    expect(contentY * result.scale + result.y).toBeCloseTo(pointerY, 5);
  });
});
