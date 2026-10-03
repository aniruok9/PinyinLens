// Pure view math. A view maps content pixels to screen pixels: screen = content * scale + [tx, ty].

export const fitScale = (contentW, contentH, viewW, viewH) => Math.min(viewW / contentW, viewH / contentH);

// Live camera: the content fitted to the screen, zoomed by `zoom` (1 = fit) about its centre.
export function liveView(contentW, contentH, viewW, viewH, zoom) {
  const scale = fitScale(contentW, contentH, viewW, viewH) * zoom;
  return { scale, tx: viewW / 2 - (contentW / 2) * scale, ty: viewH / 2 - (contentH / 2) * scale };
}

// The part of the content visible on screen, clamped to the content, in whole pixels.
export function visibleRegion(view, contentW, contentH, viewW, viewH) {
  const x = Math.max(0, Math.floor(-view.tx / view.scale));
  const y = Math.max(0, Math.floor(-view.ty / view.scale));
  const right = Math.min(contentW, Math.ceil((viewW - view.tx) / view.scale));
  const bottom = Math.min(contentH, Math.ceil((viewH - view.ty) / view.scale));
  return { x, y, width: right - x, height: bottom - y };
}

// Keeps a frozen view legal: scale between fit and maxScale; along each axis the content is
// centred when it is narrower than the screen, otherwise it covers the screen edge to edge.
export function clampView(view, contentW, contentH, viewW, viewH, maxScale) {
  const scale = Math.min(Math.max(view.scale, fitScale(contentW, contentH, viewW, viewH)), maxScale);
  const axis = (t, content, screen) => {
    const size = content * scale;
    return size <= screen ? (screen - size) / 2 : Math.min(0, Math.max(screen - size, t));
  };
  return { scale, tx: axis(view.tx, contentW, viewW), ty: axis(view.ty, contentH, viewH) };
}

// Zooms by `factor`, keeping the content under screen point (px, py) in place.
export const zoomAt = (view, factor, px, py) => ({
  scale: view.scale * factor,
  tx: px - (px - view.tx) * factor,
  ty: py - (py - view.ty) * factor,
});

export const panBy = (view, dx, dy) => ({ scale: view.scale, tx: view.tx + dx, ty: view.ty + dy });

export const toScreen = (view, [x, y]) => [x * view.scale + view.tx, y * view.scale + view.ty];

export const cssTransform = (view) => `matrix(${view.scale}, 0, 0, ${view.scale}, ${view.tx}, ${view.ty})`;
