import { describe, expect, test } from 'bun:test';

const { TABLE_VIEWER_SCALE, canPanViewport, clampScale, snapScaleToPixelGrid } = await import(
  './tableViewerConstants'
);

describe('clampScale', () => {
  test('keeps the value inside the supported range', () => {
    expect(clampScale(10)).toBe(TABLE_VIEWER_SCALE.max);
    expect(clampScale(0.01)).toBe(TABLE_VIEWER_SCALE.min);
    expect(clampScale(1)).toBe(1);
  });
});

describe('canPanViewport', () => {
  test('reports no pan when the scaled table fits the viewport', () => {
    expect(
      canPanViewport({
        contentWidth: 400,
        contentHeight: 100,
        viewportWidth: 800,
        viewportHeight: 800,
        scale: 2,
      }),
    ).toBe(false);
  });

  test('reports pan when the scaled width overflows the viewport', () => {
    expect(
      canPanViewport({
        contentWidth: 400,
        contentHeight: 100,
        viewportWidth: 800,
        viewportHeight: 800,
        scale: 3,
      }),
    ).toBe(true);
  });

  test('reports pan when the scaled height overflows the viewport', () => {
    expect(
      canPanViewport({
        contentWidth: 400,
        contentHeight: 1600,
        viewportWidth: 800,
        viewportHeight: 800,
        scale: 2,
      }),
    ).toBe(true);
  });

  test('treats an exact size match as no pan', () => {
    // 400 * 2 === 800 in both axes: the table exactly fills the panel, so the
    // sub-pixel slack must not turn the boundary into an overflow.
    expect(
      canPanViewport({
        contentWidth: 400,
        contentHeight: 400,
        viewportWidth: 800,
        viewportHeight: 800,
        scale: 2,
      }),
    ).toBe(false);
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
