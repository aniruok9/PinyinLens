import { describe, expect, it } from 'vitest';
import { clampView, cssTransform, fitScale, liveView, panBy, resizeView, toScreen, visibleRegion, zoomAt } from '../../src/app/view.js';

describe('liveView', () => {
  it('fits and centres the content at zoom 1', () => {
    // 1920x1080 on a 400x800 portrait screen: width-limited, scale 400/1920.
    const view = liveView(1920, 1080, 400, 800, 1);
    expect(view.scale).toBeCloseTo(400 / 1920);
    expect(view.tx).toBeCloseTo(0);
    expect(view.ty).toBeCloseTo((800 - 1080 * (400 / 1920)) / 2);
  });

  it('zooms about the content centre', () => {
    const view = liveView(1000, 1000, 500, 500, 2);
    expect(view.scale).toBe(1);
    expect(toScreen(view, [500, 500])).toEqual([250, 250]);
  });
});

describe('visibleRegion', () => {
  it('is the whole content when everything is on screen', () => {
    const view = liveView(1920, 1080, 400, 800, 1);
    expect(visibleRegion(view, 1920, 1080, 400, 800)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('is the centred part on screen after zooming in', () => {
    const view = liveView(1000, 1000, 500, 500, 2); // scale 1: shows content 250..750
    expect(visibleRegion(view, 1000, 1000, 500, 500)).toEqual({ x: 250, y: 250, width: 500, height: 500 });
  });
});

describe('clampView', () => {
  const content = [400, 200];
  const screen = [400, 800];

  it('never zooms out past fit, and centres content narrower than the screen', () => {
    const view = clampView({ scale: 0.1, tx: 50, ty: 0 }, ...content, ...screen, 8);
    expect(view.scale).toBe(fitScale(...content, ...screen));
    expect([view.tx, view.ty]).toEqual([0, 300]);
  });

  it('keeps zoomed-in content covering the screen edge to edge', () => {
    const view = clampView({ scale: 4, tx: 100, ty: -5000 }, ...content, ...screen, 8);
    expect(view.tx).toBe(0); // can't pull the left edge inside the screen
    expect(view.ty).toBe(800 - 200 * 4); // can't push the bottom edge above the screen bottom
  });

  it('caps the scale', () => {
    expect(clampView({ scale: 50, tx: 0, ty: 0 }, ...content, ...screen, 8).scale).toBe(8);
  });
});

describe('zoomAt / panBy / cssTransform', () => {
  it('keeps the point under the fingers fixed while zooming', () => {
    const view = { scale: 1, tx: 10, ty: 20 };
    const zoomed = zoomAt(view, 3, 110, 220); // content point (100, 200)
    expect(toScreen(zoomed, [100, 200])).toEqual([110, 220]);
    expect(zoomed.scale).toBe(3);
  });

  it('pans by screen pixels', () => {
    expect(panBy({ scale: 2, tx: 1, ty: 2 }, 5, -5)).toEqual({ scale: 2, tx: 6, ty: -3 });
  });

  it('renders a CSS matrix', () => {
    expect(cssTransform({ scale: 2, tx: 3, ty: 4 })).toBe('matrix(2, 0, 0, 2, 3, 4)');
  });
});

describe('resizeView', () => {
  const close = (actual, expected) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));

  it('keeps a fitted view fitted when the screen rotates', () => {
    const landscape = clampView({ scale: 0, tx: 0, ty: 0 }, 1479, 883, 844, 390, 100);
    const portrait = resizeView(landscape, 1479, 883, 844, 390, 390, 844);
    expect(portrait.scale).toBeCloseTo(fitScale(1479, 883, 390, 844));
    close(toScreen(portrait, [1479 / 2, 883 / 2]), [195, 422]);
  });

  it('keeps the zoom relative to fit and the content under the screen centre', () => {
    const view = { scale: 2 * fitScale(1000, 500, 400, 800), tx: -100, ty: 50 };
    const centre = [(200 - view.tx) / view.scale, (400 - view.ty) / view.scale];
    const resized = resizeView(view, 1000, 500, 400, 800, 800, 400);
    expect(resized.scale / fitScale(1000, 500, 800, 400)).toBeCloseTo(2);
    close(toScreen(resized, centre), [400, 200]);
  });
});
