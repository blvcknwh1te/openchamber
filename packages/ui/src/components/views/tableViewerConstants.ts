/**
 * Limits and helpers for the markdown table viewer surface. The table opens
 * fitted to the panel and centered, then the user pans and zooms within these
 * bounds.
 */
export const TABLE_VIEWER_SCALE = {
  /** Opening zoom is clamped to this range so a tiny or huge table stays usable. */
  min: 0.33,
  max: 2.5,
  /** Multiplicative zoom step for one wheel notch. */
  wheelStep: 0.1,
  /** Below this delta the applied zoom is treated as unchanged. */
  epsilon: 0.005,
} as const;

/** Keeps a requested scale inside the supported range. */
export const clampScale = (value: number): number =>
  Math.min(TABLE_VIEWER_SCALE.max, Math.max(TABLE_VIEWER_SCALE.min, value));

/** Zoom applied by one wheel notch, expressed as a multiplier around 1. */
export const TABLE_VIEWER_WHEEL_FACTOR = 1 + TABLE_VIEWER_SCALE.wheelStep;

export type ZoomInput = {
  currentScale: number;
  deltaY: number;
  /** Pointer position relative to the viewport center. */
  pointerX: number;
  pointerY: number;
  /** Current pan, offset from the viewport center as well. */
  originX: number;
  originY: number;
};

export type ZoomResult = {
  scale: number;
  x: number;
  y: number;
};

/**
 * Applies one wheel notch around the pointer: the point under the cursor keeps
 * its position while the scale changes, which is what an image viewer does.
 * Returns null when the notch is too small to move the clamped scale.
 */
export const zoomTableAtPointer = ({
  currentScale,
  deltaY,
  pointerX,
  pointerY,
  originX,
  originY,
}: ZoomInput): ZoomResult | null => {
  const next = clampScale(
    currentScale * (deltaY < 0 ? TABLE_VIEWER_WHEEL_FACTOR : 1 / TABLE_VIEWER_WHEEL_FACTOR),
  );
  if (Math.abs(next - currentScale) < TABLE_VIEWER_SCALE.epsilon) return null;

  const ratio = next / currentScale;
  return {
    scale: next,
    x: pointerX - (pointerX - originX) * ratio,
    y: pointerY - (pointerY - originY) * ratio,
  };
};
