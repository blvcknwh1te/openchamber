import * as React from 'react';

import { SimpleMarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { clampScale, snapScaleToPixelGrid, TABLE_VIEWER_SCALE, zoomTableAtPointer } from './tableViewerConstants';
import { isOnText, shouldStartPan } from './tableViewerPan';

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
 * Full-bleed surface for a single markdown table: the table is fitted to the
 * panel on open, panned by dragging the empty surround (or anywhere while Ctrl
 * is held) and zoomed with the wheel, the way an image preview behaves. The
 * table keeps native text selection unless Ctrl turns the press into a pan.
 * Nothing is drawn behind it and no scrollbars appear.
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
  // Ctrl turns every press into a pan; without it only the empty area pans and
  // the table itself keeps native text selection.
  const [panArmed, setPanArmed] = React.useState(false);

  const applyScale = React.useCallback((next: number) => {
    const snapped = clampScale(snapScaleToPixelGrid(next, window.devicePixelRatio || 1));
    if (Math.abs(snapped - scaleRef.current) < TABLE_VIEWER_SCALE.epsilon) return;
    scaleRef.current = snapped;
    setScale(snapped);
  }, []);

  // Fit to the panel when the markdown changes. The table is rendered by a
  // child component, so on the first pass the content box is still empty; the
  // observer therefore watches the content itself and refits once it has size.
  // Pan returns to zero, which is what keeps the fitted table centered until the
  // first drag.
  React.useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    scaleRef.current = 1;
    setScale(1);
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });

    // Fits once per markdown change. The child renderer may paint its table a
    // tick later, so the observer keeps watching until the first successful
    // measurement; after that a resize must not undo a user's zoom.
    let fitted = false;
    const fit = () => {
      const rect = content.getBoundingClientRect();
      const naturalWidth = rect.width;
      const naturalHeight = rect.height;
      if (naturalWidth <= 0 || naturalHeight <= 0) return;

      // The table fills the viewport along its tighter axis, so neither a wide
      // nor a tall table gets clipped and no empty margin is left over.
      applyScale(Math.min(viewport.clientWidth / naturalWidth, viewport.clientHeight / naturalHeight));
      fitted = true;
    };

    const observer = new ResizeObserver(() => {
      if (!fitted) fit();
    });
    observer.observe(content);
    fit();
    return () => observer.disconnect();
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
        overText: isOnText(event.clientX, event.clientY),
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
      className={`h-full w-full cursor-grab overflow-hidden touch-none ${
        dragging ? 'cursor-grabbing' : ''
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
          panArmed ? 'cursor-grab select-none' : ''
        }`}
      >
        <SimpleMarkdownRenderer content={markdown} enableFileReferences={false} />
      </div>
    </div>
  );
};

TableViewerView.displayName = 'TableViewerView';
