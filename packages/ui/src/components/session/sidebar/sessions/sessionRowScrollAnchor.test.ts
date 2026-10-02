import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

const { holdSessionRowPosition } = await import('./sessionRowScrollAnchor');

// `holdSessionRowPosition` compensates the scroll container for a few frames
// after a row is selected, so the clicked row stays under the pointer. The
// regression it guards: the cancellation used to listen on the container in the
// bubble phase, so a wheel event that never reached the container (a row
// tooltip portal, the overlay scrollbar thumb, a sticky header) failed to cancel
// the compensation and the list snapped back under the user's wheel.
describe('holdSessionRowPosition', () => {
  let windowInstance: Window;
  let frames: Array<(timestamp: number) => void>;
  let scrollTop: number;

  const flushFrames = (count: number) => {
    for (let index = 0; index < count; index += 1) {
      const pending = frames;
      frames = [];
      for (const callback of pending) callback(0);
    }
  };

  const rect = (top: number): DOMRect => (
    { top, bottom: top, left: 0, right: 0, width: 0, height: 0 } as DOMRect
  );

  const buildRow = () => {
    const container = document.createElement('div');
    container.className = 'overlay-scrollbar-container';
    scrollTop = 0;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });

    const row = document.createElement('button');
    row.setAttribute('data-session-row', '');
    // Only the row moves, as if an expanded child pushed it down and the
    // compensation has to bring it back.
    let rowTop = 100;
    Object.defineProperty(row, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(rowTop),
    });
    Object.defineProperty(container, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(0),
    });

    container.appendChild(row);
    document.body.appendChild(container);
    return { container, row, shiftRow: (top: number) => { rowTop = top; } };
  };

  beforeEach(() => {
    windowInstance = new Window();
    frames = [];
    Object.assign(globalThis, {
      window: windowInstance,
      document: windowInstance.document,
      HTMLElement: windowInstance.HTMLElement,
      Node: windowInstance.Node,
    });
    // Frame callbacks are captured instead of scheduled so the compensation
    // loop can be advanced one frame at a time.
    Object.assign(windowInstance, {
      requestAnimationFrame: (callback: (timestamp: number) => void) => {
        frames.push(callback);
        return frames.length;
      },
      cancelAnimationFrame: () => {
        frames = [];
      },
    });
  });

  afterEach(async () => {
    await windowInstance.happyDOM.close();
  });

  test('compensates the container when the selected row shifts', () => {
    const { row, shiftRow } = buildRow();
    holdSessionRowPosition(row);

    shiftRow(140);
    flushFrames(1);

    expect(scrollTop).toBe(40);
  });

  test('stops compensating on a wheel event that never reaches the container', () => {
    const { row, shiftRow } = buildRow();
    holdSessionRowPosition(row);

    // A tooltip portal lives outside the scroll container, so the wheel event
    // it receives does not bubble through the container.
    const tooltipPopup = document.createElement('div');
    document.body.appendChild(tooltipPopup);
    tooltipPopup.dispatchEvent(
      new windowInstance.Event('wheel', { bubbles: true }) as unknown as Event,
    );

    shiftRow(140);
    flushFrames(3);

    expect(scrollTop).toBe(0);
  });

  test('stops compensating once the frame budget is spent', () => {
    const { row, shiftRow } = buildRow();
    holdSessionRowPosition(row);

    shiftRow(140);
    flushFrames(3);
    const afterBudget = scrollTop;

    shiftRow(200);
    flushFrames(3);

    expect(scrollTop).toBe(afterBudget);
  });

  test('does nothing when the target is not a session row', () => {
    const { container } = buildRow();
    const stray = document.createElement('div');
    container.appendChild(stray);

    holdSessionRowPosition(stray);
    flushFrames(3);

    expect(scrollTop).toBe(0);
  });
});
