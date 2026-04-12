export function initZoom(container) {
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let zoomFloor = 1;
  let panEnabled = false;

  // Pinch state
  let startDist = 0;
  let startScale = 1;

  // Pan state
  let startPanX = 0;
  let startPanY = 0;
  let startTouchX = 0;
  let startTouchY = 0;

  function applyTransform() {
    container.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }

  function fingerDist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      startDist = fingerDist(e.touches[0], e.touches[1]);
      startScale = scale;
    } else if (e.touches.length === 1 && panEnabled) {
      startTouchX = e.touches[0].clientX;
      startTouchY = e.touches[0].clientY;
      startPanX = panX;
      startPanY = panY;
    }
  }, { passive: false });

  container.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = fingerDist(e.touches[0], e.touches[1]);
      const newScale = startScale * (dist / startDist);
      scale = Math.max(zoomFloor, newScale);
      applyTransform();
    } else if (e.touches.length === 1 && panEnabled) {
      e.preventDefault();
      panX = startPanX + (e.touches[0].clientX - startTouchX);
      panY = startPanY + (e.touches[0].clientY - startTouchY);
      applyTransform();
    }
  }, { passive: false });

  container.addEventListener('touchend', (e) => {
    // When pinch ends (going from 2 fingers to 1), reset single-finger
    // tracking so the remaining finger doesn't cause a pan jump.
    if (e.touches.length === 1 && panEnabled) {
      startTouchX = e.touches[0].clientX;
      startTouchY = e.touches[0].clientY;
      startPanX = panX;
      startPanY = panY;
    }
  });

  return {
    lockFloor() {
      zoomFloor = scale;
      panEnabled = true;
    },

    reset() {
      scale = 1;
      panX = 0;
      panY = 0;
      zoomFloor = 1;
      panEnabled = false;
      applyTransform();
    },
  };
}
