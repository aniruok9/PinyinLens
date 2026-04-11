export function renderOverlay(ctx, results) {
  for (const r of results) {
    const { box, pinyin } = r;
    if (!box || !pinyin) continue;

    const pinyinY = box.y + box.height + 2;
    const fontSize = Math.max(12, Math.min(box.height * 0.6, 32));

    // Semi-transparent background strip below the detected text
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(box.x, pinyinY, box.width, fontSize + 6);

    // Pinyin text
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.fillText(pinyin, box.x + 3, pinyinY + 3, box.width - 6);
  }
}
