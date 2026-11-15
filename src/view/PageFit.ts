export interface PageFitResult {
  scale: number;
  height: number;
}

/** Find the largest usable zoom, including the text reflow caused by CSS zoom. */
export function fitColumns(
  grid: HTMLElement,
  columns: HTMLElement[],
  availableHeight: number,
  autoFit: boolean
): PageFitResult {
  const measure = (scale: number): number => {
    grid.style.zoom = String(scale);
    // scrollHeight is in local, unzoomed CSS pixels, even when zoom is applied.
    return Math.max(...columns.map(col => col.scrollHeight)) * scale;
  };

  let height = measure(1);
  if (!autoFit || height <= availableHeight) return { scale: 1, height };

  // Search thousandths so repeated fits always settle on the same value.
  let low = 650;
  let high = 1000;
  height = measure(low / 1000);
  if (height > availableHeight) return { scale: low / 1000, height };
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (measure(mid / 1000) <= availableHeight) low = mid;
    else high = mid;
  }
  const scale = low / 1000;
  return { scale, height: measure(scale) };
}
