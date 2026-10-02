import * as React from 'react';

import { SimpleMarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { fitScaleToWidth, TABLE_VIEWER_SCALE, zoomTableAtPointer } from './tableViewerConstants';
import { panAreaOf, shouldStartPan } from './tableViewerPan';

interface TableViewerViewProps {
  markdown: string | null;
}

type PanState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

/**
 * Full-bleed surface for a single markdown table: the table is scaled so its
 * whole width fits the panel width on open, panned by dragging the surround (or
 * anywhere while Ctrl is held, or with the middle button) and zoomed with the
 * wheel, the way an image preview behaves. The table keeps native text selection
 * unless Ctrl turns the press into a pan, so the grab cursor belongs to the
 * surround and a fitted table is no less draggable than a wide one. The surface
 * behind the table uses the muted background so the elevated table (its own
 * `surface-elevated` wrapper) stays clearly separated instead of blending into
 * the panel; no scrollbars appear.
 */
export const TableViewerView: React.FC<TableViewerViewProps> = ({ markdown }) => {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const scaleRef = React.useRef(1);
  const panRef = React.useRef({ x: 0, y: 0 });
  const dragRef = React.useRef<PanState | null>(null);

  const [scale, setScale] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  // Ctrl turns every press into a pan; the same is offered by the middle button.
  // Without them only the surround pans and the table keeps native text
  // selection.
  const [panArmed, setPanArmed] = React.useState(false);

  // Writes a scale that was already resolved by its owner — `fitScaleToWidth`
  // for the opening fit, `zoomTableAtPointer` for the wheel — so the value is
  // applied as computed. The epsilon guard keeps a repeated fit from re-rendering
  // for no visible change.
  const applyScale = React.useCallback((next: number) => {
    if (Math.abs(next - scaleRef.current) < TABLE_VIEWER_SCALE.epsilon) return;
    scaleRef.current = next;
    setScale(next);
  }, []);

  // Fit to the panel when the markdown changes. The table is rendered by a
  // child component, so on the first pass the content box is still empty; the
  // observer therefore watches the content itself and refits once it has size.
  // Pan returns to zero, which is what keeps the fitted table centered until the
  // first drag. The observer stops at the first successful measurement: the
  // cursor and the pan rule read the element under the pointer instead of the
  // measured boxes, so nothing downstream needs the geometry to stay current.
  React.useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    scaleRef.current = 1;
    setScale(1);
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });

    let observer: ResizeObserver | null = null;

    const fit = () => {
      const rect = content.getBoundingClientRect();
      const naturalWidth = rect.width;
      if (naturalWidth <= 0) return;

      // Fit across the width only, so the whole table is visible side to side.
      applyScale(fitScaleToWidth(viewport.clientWidth, naturalWidth, window.devicePixelRatio || 1));

      // Reflow after a resize must not undo the user's zoom, so the watch ends
      // here.
      observer?.disconnect();
      observer = null;
    };

    observer = new ResizeObserver(() => fit());
    observer.observe(content);
    observer.observe(viewport);
    fit();
    return () => observer?.disconnect();
  }, [markdown, applyScale]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => setPanArmed(event.ctrlKey || event.metaKey);
    const onBlur = () => setPanArmed(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      !shouldStartPan({
        button: event.button,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        area: panAreaOf(event.target),
      })
    ) {
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panRef.current.x,
      originY: panRef.current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = {
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    };
    panRef.current = next;
    setPan(next);
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  // React's onWheel is passive, so the zoom listener is attached natively to be
  // able to cancel the page scroll. Zoom is anchored at the cursor: the point
  // under the pointer keeps its position while the scale changes.
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (event: WheelEvent) => {
      // The surface has no scrollbars, so the wheel only zooms, Ctrl or not.
      event.preventDefault();

      const current = scaleRef.current || 1;
      const rect = viewport.getBoundingClientRect();
      const origin = panRef.current;
      // The content is centered in the viewport, so both the pointer and the pan
      // are expressed as offsets from that center; the point under the cursor is
      // the one kept in place across the zoom.
      const zoomed = zoomTableAtPointer({
        currentScale: current,
        deltaY: event.deltaY,
        pointerX: event.clientX - rect.left - rect.width / 2,
        pointerY: event.clientY - rect.top - rect.height / 2,
        originX: origin.x,
        originY: origin.y,
      });
      if (!zoomed) return;

      scaleRef.current = zoomed.scale;
      panRef.current = { x: zoomed.x, y: zoomed.y };
      setScale(zoomed.scale);
      setPan({ x: zoomed.x, y: zoomed.y });
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  if (!markdown) return null;

  return (
    <div
      ref={viewportRef}
      className={`bg-surface-muted h-full w-full overflow-hidden touch-none ${
        dragging ? 'cursor-grabbing' : 'cursor-grab'
      } ${panArmed ? 'select-none' : 'select-auto'}`}
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      // The middle button would otherwise start the browser's autoscroll, which
      // fights the pan that button now performs.
      onAuxClick={(event) => event.preventDefault()}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
    >
      <div
        ref={contentRef}
        style={{
          // `zoom` re-runs layout so glyphs are rasterized at the target size and
          // stay sharp, unlike a transform scale over a bitmap. It also scales
          // translate values, so the pan is divided back out to keep the drag
          // distance matching the pointer. `will-change: transform` is omitted on
          // purpose: promoting the node to its own GPU layer makes Chromium
          // resample that layer at fractional zoom, which is what blurred the
          // text at the fitted scale.
          zoom: scale,
          transform: `translate(-50%, -50%) translate(${pan.x / scale}px, ${pan.y / scale}px)`,
          transformOrigin: 'center',
        }}
        className={`absolute left-1/2 top-1/2 w-max ${
          panArmed ? 'cursor-grab select-none' : 'cursor-auto select-auto'
        }`}
      >
        <SimpleMarkdownRenderer content={markdown} enableFileReferences={false} />
      </div>
    </div>
  );
};

TableViewerView.displayName = 'TableViewerView';
