export function renderOverlay(ctx, results) {
  for (const r of results) {
    const { box, groups, totalWeight } = r;
    if (!box || !groups || groups.length === 0) continue;

    const unitWidth = box.width / totalWeight;
    const cjkCharWidth = unitWidth * 2; // CJK chars are weighted as 2 units

    // Base font size from box height, but shrink to fit the widest syllable
    // within its character cell so neighboring pinyin doesn't overlap.
    let fontSize = box.height * 0.45;
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;

    let maxSyllableWidth = 0;
    for (const group of groups) {
      for (const syll of group.pinyin) {
        const w = ctx.measureText(syll).width;
        if (w > maxSyllableWidth) maxSyllableWidth = w;
      }
    }

    // Leave 10% horizontal padding between adjacent syllables
    const maxAllowedWidth = cjkCharWidth * 0.9;
    if (maxSyllableWidth > maxAllowedWidth) {
      fontSize *= maxAllowedWidth / maxSyllableWidth;
    }

    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';

    const stripHeight = fontSize + 4;
    const pinyinY = box.y + box.height + 2;

    for (const group of groups) {
      for (let i = 0; i < group.chars.length; i++) {
        const x = box.x + (group.weightOffset + i * 2) * unitWidth;

        // Semi-transparent background strip for this character's pinyin
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(x, pinyinY, cjkCharWidth, stripHeight);

        // Pinyin syllable centered under the character
        ctx.fillStyle = '#ffffff';
        ctx.fillText(group.pinyin[i], x + cjkCharWidth / 2, pinyinY + 2);
      }
    }
  }
}
