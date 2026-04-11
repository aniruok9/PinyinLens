export async function capturePhoto(canvas) {
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );

  if (navigator.canShare && navigator.canShare({ files: [new File([blob], 'pinyin.png')] })) {
    await navigator.share({
      files: [new File([blob], 'pinyin-lens.png', { type: 'image/png' })],
    });
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pinyin-lens.png';
    a.click();
    URL.revokeObjectURL(url);
  }
}
