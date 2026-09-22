import { describe, expect, test } from 'bun:test';

const { TABLE_VIEWER_SCALE, clampScale, snapScaleToPixelGrid } = await import('./tableViewerConstants');

describe('clampScale', () => {
  test('keeps the value inside the supported range', () => {
    expect(clampScale(10)).toBe(TABLE_VIEWER_SCALE.max);
    expect(clampScale(0.01)).toBe(TABLE_VIEWER_SCALE.min);
    expect(clampScale(1)).toBe(1);
  });
});

describe('snapScaleToPixelGrid', () => {
  test('rounds to whole steps on a standard display', () => {
    expect(snapScaleToPixelGrid(1.21, 1)).toBe(1);
    expect(snapScaleToPixelGrid(1.6, 1)).toBe(2);
  });

  test('rounds to half steps on a retina display', () => {
    expect(snapScaleToPixelGrid(1.21, 2)).toBe(1);
    expect(snapScaleToPixelGrid(1.3, 2)).toBe(1.5);
  });

  test('treats a non-positive ratio as a standard display', () => {
    expect(snapScaleToPixelGrid(1.6, 0)).toBe(2);
  });
});
