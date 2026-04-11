export function renderOverlay(ctx, results) {
  for (const r of results) {
    const { box, pinyin } = r;
    if (!box || !pinyin) continue;

    const pinyinY = box.y + box.height + 4;
    const fontSize = Math.max(14, Math.min(box.height * 0.5, 28));

    // Semi-transparent background strip
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(box.x, pinyinY - fontSize, box.width, fontSize + 6);

    // Pinyin text
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.fillText(pinyin, box.x + 4, pinyinY - fontSize + 2, box.width - 8);
  }
}
