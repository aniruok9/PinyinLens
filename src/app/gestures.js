// Pointer gestures on an element (spec §7.3): two-finger pinch reports a scale factor about the
// fingers' midpoint plus the midpoint's movement; one-finger drag reports movement; the mouse
// wheel zooms (desktop testing). Coordinates are client pixels.
export function bindGestures(element, { onPinch, onDrag }) {
  const pointers = new Map();
  let last = null; // { distance, mid } while pinching, { point } while dragging

  element.addEventListener('pointerdown', (event) => {
    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    last = null;
  });

  element.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    const [a, b] = pointers.values();
    if (b) {
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (last?.distance) {
        onPinch(distance / last.distance, mid[0], mid[1]);
        onDrag(mid[0] - last.mid[0], mid[1] - last.mid[1]);
      }
      last = { distance, mid };
    } else {
      if (last?.point) onDrag(a[0] - last.point[0], a[1] - last.point[1]);
      last = { point: a };
    }
  });

  const release = (event) => {
    pointers.delete(event.pointerId);
    last = null;
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);

  element.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      onPinch(Math.exp(-event.deltaY / 300), event.clientX, event.clientY);
    },
    { passive: false },
  );
}
