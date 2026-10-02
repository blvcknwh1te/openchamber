import { streamPerfCount } from '@/stores/utils/streamDebug';

// Selecting a row can shift the list (expanded children, reflowed headers).
// `holdSessionRowPosition` compensates the scroll container for a few frames so
// the row the user just clicked stays under the pointer. The compensation must
// yield the moment the user scrolls instead: otherwise the list snaps back and
// the wheel looks broken.
const cancelScrollAnchorByContainer = new WeakMap<HTMLElement, () => void>();

/** How many frames the selection compensation stays armed. */
const HOLD_FRAMES = 3;

/** Compensation below this offset is noise, not a layout shift. */
const MIN_ADJUSTMENT_PX = 0.5;

export const holdSessionRowPosition = (target: HTMLElement): void => {
  const row = target.closest<HTMLElement>('[data-session-row]');
  const container = row?.closest<HTMLElement>('.overlay-scrollbar-container');
  if (!row || !container) return;

  cancelScrollAnchorByContainer.get(container)?.();

  const initialTop = row.getBoundingClientRect().top;
  let remainingFrames = HOLD_FRAMES;
  let cancelled = false;
  let frameId: number | null = null;
  const cancel = () => {
    cancelled = true;
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    frameId = null;
    cancelScrollAnchorByContainer.delete(container);
    // Capture-phase listeners on `window` rather than on the container. The
    // wheel may never reach the container: a row tooltip renders into a portal
    // over the list, the overlay scrollbar thumb sits above the rows, and a
    // sticky project header covers the top of the viewport. A missed
    // cancellation left the frames below fighting the user's scroll.
    window.removeEventListener('wheel', cancel, true);
    window.removeEventListener('touchstart', cancel, true);
  };
  const restore = () => {
    if (cancelled || !row.isConnected || !container.isConnected) {
      cancel();
      return;
    }
    const delta = row.getBoundingClientRect().top - initialTop;
    if (Math.abs(delta) > MIN_ADJUSTMENT_PX) {
      container.scrollTop += delta;
      streamPerfCount('ui.sidebar.selection_scroll_anchor_adjustment');
    }
    remainingFrames -= 1;
    if (remainingFrames <= 0) {
      cancel();
      return;
    }
    frameId = window.requestAnimationFrame(restore);
  };

  window.addEventListener('wheel', cancel, { capture: true, passive: true });
  window.addEventListener('touchstart', cancel, { capture: true, passive: true });
  cancelScrollAnchorByContainer.set(container, cancel);
  frameId = window.requestAnimationFrame(restore);
};
