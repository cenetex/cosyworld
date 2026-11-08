// Alpha framing belongs to the live image, including retained card nodes.
export function createFigureFramer(createCanvas) {
  const figures = new Map();
  const framed = new WeakMap();

  function frameFigure(img) {
    if (framed.has(img)) {
      framed.get(img)();
      return;
    }
    const apply = (f) => {
      img.style.setProperty("--figure-top", f.top);
      img.style.setProperty("--figure-height", f.height);
      img.style.setProperty("--head-x", f.headX);
      img.style.setProperty("--portrait-crop", f.portraitCrop);
    };
    const measure = () => {
      if (!img.complete || !img.naturalWidth || !img.naturalHeight) return;
      if (!figures.has(img.src)) {
        const w = 48,
          h = Math.round((w * img.naturalHeight) / img.naturalWidth) || w;
        const canvas = createCanvas();
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(img, 0, 0, w, h);
        let alpha;
        try {
          alpha = context.getImageData(0, 0, w, h).data;
        } catch {
          return;
        }
        const solid = (x, y) => alpha[(y * w + x) * 4 + 3] > 40;
        const rows = [];
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++)
            if (solid(x, y)) {
              rows.push(y);
              break;
            }
        if (!rows.length) return;
        const top = rows[0],
          bottom = rows.at(-1) + 1,
          head = top + Math.max(1, Math.round((bottom - top) * 0.15));
        let left = w,
          right = 0;
        for (let y = top; y < head; y++)
          for (let x = 0; x < w; x++)
            if (solid(x, y)) {
              left = Math.min(left, x);
              right = Math.max(right, x + 1);
            }
        figures.set(img.src, {
          top: top / h,
          height: (bottom - top) / h,
          headX: (left + right) / 2 / w,
          portraitCrop:
            img.naturalHeight / img.naturalWidth < 1.25 ? 0.85 : 0.3,
        });
      }
      apply(figures.get(img.src));
    };
    // Kept hand cards change source in place. Re-measure the live image on
    // every load, not only the first sleeping/standing portrait.
    framed.set(img, measure);
    img.addEventListener("load", measure);
    measure();
  }
  return {
    frameFigure,
    syncFigureFrame: (image, template) => {
      if (framed.has(template)) frameFigure(image);
    },
  };
}
