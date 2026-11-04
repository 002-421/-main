function summarizeFrame(image) {
  const { width, height } = image.getSize();
  const pixels = image.getBitmap();
  const colorCounts = new Map();
  const stepX = Math.max(1, Math.floor(width / 80));
  const stepY = Math.max(1, Math.floor(height / 45));
  let sampledPixels = 0;
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const offset = (y * width + x) * 4;
      if (offset + 3 >= pixels.length) continue;
      const color = `#${[pixels[offset + 2], pixels[offset + 1], pixels[offset]].map(value => value.toString(16).padStart(2, '0')).join('')}`;
      colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
      sampledPixels++;
    }
  }
  const dominantColors = [...colorCounts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([color, count]) => ({ color, count }));
  return { width, height, sampledPixels, distinctSampleColors: colorCounts.size, dominantColors };
}

module.exports = { summarizeFrame };
