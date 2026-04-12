export function renderOverlay(ctx, results) {
  for (const r of results) {
    const { box, groups, totalWeight } = r;
    if (!box || !groups || groups.length === 0) continue;

    const unitWidth = box.width / totalWeight;
    const cjkCharWidth = unitWidth * 2; // CJK chars are weighted as 2 units
    const fontSize = box.height * 0.6;
    const pinyinY = box.y + box.height + 2;

    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';

    for (const group of groups) {
      for (let i = 0; i < group.chars.length; i++) {
        const x = box.x + (group.weightOffset + i * 2) * unitWidth;

        // Semi-transparent background strip for this character's pinyin
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(x, pinyinY, cjkCharWidth, fontSize + 6);

        // Pinyin syllable centered under the character
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(group.pinyin[i], x + cjkCharWidth / 2, pinyinY + 3);
      }
    }
  }
}
