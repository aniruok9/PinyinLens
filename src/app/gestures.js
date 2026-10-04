// Pointer gestures on an element (spec §7.3): two-finger pinch reports a scale factor about the
// fingers' midpoint plus the midpoint's movement; one-finger drag reports movement; a quick
// one-finger touch that barely moves is a tap; the mouse wheel zooms (desktop testing).
// Coordinates are client pixels.
const TAP_SLOP = 10; // px
const TAP_MS = 300;

export function bindGestures(element, { onPinch, onDrag, onTap }) {
  const pointers = new Map();
  let last = null; // { distance, mid } while pinching, { point } while dragging
  let tap = null; // { id, x, y, time } while a touch could still be a tap

  element.addEventListener('pointerdown', (event) => {
    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    last = null;
    tap = pointers.size === 1 ? { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp } : null;
  });

  element.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) >= TAP_SLOP) tap = null;
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
  element.addEventListener('pointerup', (event) => {
    const tapped = tap?.id === event.pointerId && event.timeStamp - tap.time < TAP_MS;
    tap = null;
    release(event);
    if (tapped) onTap(event.clientX, event.clientY);
  });
  element.addEventListener('pointercancel', (event) => {
    tap = null;
    release(event);
  });

  element.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      onPinch(Math.exp(-event.deltaY / 300), event.clientX, event.clientY);
    },
    { passive: false },
  );
}
