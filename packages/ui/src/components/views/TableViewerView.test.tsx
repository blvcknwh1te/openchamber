import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The real renderer pulls in Vite-only worker imports, which the test runner
// cannot resolve; the view under test only needs a markdown-shaped child.
mock.module('@/components/chat/MarkdownRenderer', () => ({
  SimpleMarkdownRenderer: ({ content }: { content: string }) => <div data-content={content} />,
}));

const { TableViewerView } = await import('./TableViewerView');

const WIDE_TABLE = [
  '| one | two | three | four | five | six | seven | eight |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |',
].join('\n');

const NARROW_TABLE = ['| one | two |', '| --- | --- |', '| 1 | 2 |'].join('\n');

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

  // Geometry is patched between renders because the fit effect re-runs on the
  // markdown change and reads the measured values only when it runs.
  const measure = (available: number, natural: number) => {
    const zoomed = container.querySelector<HTMLDivElement>('div[style*="zoom"]');
    if (!zoomed) throw new Error('zoom container was not rendered');
    const viewport = zoomed.parentElement;
    if (!viewport) throw new Error('viewport was not rendered');
    Object.defineProperty(viewport, 'clientWidth', { value: available, configurable: true });
    zoomed.getBoundingClientRect = () => new windowInstance.DOMRect(0, 0, natural, 0);
    return zoomed;
  };

  test('renders nothing without markdown', async () => {
    await render(null);

    expect(container.innerHTML).toBe('');
  });

  test('scales a wide table down to the panel width', async () => {
    await render(WIDE_TABLE);
    const zoomed = measure(400, 1200);
    await render(NARROW_TABLE);

    expect(zoomed.style.zoom).toBe('0.5');
  });

  test('keeps the natural size when the panel is wide enough', async () => {
    await render(WIDE_TABLE);
    const zoomed = measure(2000, 1200);
    await render(NARROW_TABLE);

    expect(zoomed.style.zoom).toBe('1');
  });
});
