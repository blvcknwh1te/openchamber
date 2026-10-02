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

const { TABLE_VIEWER_SCALE, fitScaleToWidth, zoomTableAtPointer } = await import('./tableViewerConstants');
const { TableViewerView } = await import('./TableViewerView');

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

  test('never fits wider than the panel, even for an extremely wide table', async () => {
    await renderFitted(WIDE_TABLE, 100, { width: 4000, height: 100 });

    // Below the manual minimum on purpose: the whole table width must fit.
    const scale = getScale();
    expect(scale).toBeCloseTo(100 / 4000, 5);
    expect(scale * 4000).toBeLessThanOrEqual(100 + 1e-6);
  });

  test('enlarges a small table to fill the panel', async () => {
    await renderFitted(WIDE_TABLE, 800, { width: 400, height: 100 });

    expect(getScale()).toBeCloseTo(2, 5);
  });

  test('fits by width regardless of the table height', async () => {
    await renderFitted(WIDE_TABLE, 800, { width: 400, height: 1600 });

    // A table taller than the panel used to be shrunk by the height too
    // (min(2, 0.5) = 0.5), which is what left it short of the panel width.
    expect(getScale()).toBeCloseTo(2, 5);
  });

  test('caps the opening zoom at the configured maximum', async () => {
    await renderFitted(WIDE_TABLE, 2000, { width: 100, height: 100 });

    // The cap can only leave side margins on a very narrow table, never clip it.
    expect(getScale()).toBeCloseTo(TABLE_VIEWER_SCALE.max, 5);
  });

  test('paints the panel on the muted surface so the table stands out', async () => {
    await renderFitted(WIDE_TABLE, 800, { width: 400, height: 100 });

    const viewport = getContent().parentElement;
    expect(viewport?.className).toContain('bg-surface-muted');
  });

  test('offers the grab cursor on the surround for any table size', async () => {
    // The surround pans whatever the table size, so its cursor must not depend
    // on a measurement. A fitted table used to keep the system cursor here,
    // which is what made the cursor flip as the panel resized.
    await renderFitted(WIDE_TABLE, 800, { width: 400, height: 100 });

    const viewport = getContent().parentElement;
    expect(viewport?.className).toContain('cursor-grab');
  });

  test('keeps the table itself on the default cursor until Ctrl is held', async () => {
    // The table owns text selection, so it asks the system for the cursor
    // instead of promising a drag; the modifier turns it into a grab surface.
    await renderFitted(WIDE_TABLE, 400, { width: 1200, height: 1600 });

    const content = getContent();
    expect(content.className).toContain('cursor-auto');
    expect(content.className).not.toContain('cursor-grab');
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

describe('fitScaleToWidth', () => {
  test('fits the width exactly', () => {
    expect(fitScaleToWidth(900, 1200)).toBeCloseTo(0.75, 5);
  });

  test('keeps an extremely wide table fitted, below the manual minimum', () => {
    expect(fitScaleToWidth(100, 4000)).toBeCloseTo(0.025, 5);
  });

  test('caps the enlargement at the manual maximum', () => {
    expect(fitScaleToWidth(2000, 100)).toBe(TABLE_VIEWER_SCALE.max);
  });

  test('snaps down to the pixel grid when that keeps the width visible', () => {
    // 1600/1000 = 1.6 and a retina grid step is 0.5, so the fit lands on 1.5.
    expect(fitScaleToWidth(1600, 1000, 2)).toBeCloseTo(1.5, 5);
  });

  test('never rounds a fit up past the panel width', () => {
    // 1.4 on a 0.5 grid would round up to 1.5 and clip the right edge; the
    // exact ratio wins instead.
    const scale = fitScaleToWidth(1400, 1000, 2);
    expect(scale).toBeCloseTo(1.4, 5);
    expect(scale * 1000).toBeLessThanOrEqual(1400 + 1e-6);
  });

  test('falls back to the neutral scale without measurements', () => {
    expect(fitScaleToWidth(0, 1200)).toBe(1);
    expect(fitScaleToWidth(900, 0)).toBe(1);
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
