import { projectPaintedSpot } from "./preferred-locations.mjs";

// The existing painting box follows focus, aspect ratio, and cover cropping.
export function createPreferredLocationsView(stage, art, cast) {
  let spots = new Map();
  let frame = 0;
  function draw() {
    frame = 0;
    const artBox = art.getBoundingClientRect();
    const castBox = cast.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    const dock = document.querySelector(".play-dock").getBoundingClientRect();
    const floor = Math.min(stageBox.bottom - 12, dock.top - 6);
    const placed = [];
    for (const figure of cast.children) {
      const spot = spots.get(figure.dataset.avatar);
      if (!spot) {
        figure.style.removeProperty("left");
        figure.style.removeProperty("bottom");
        figure.style.removeProperty("max-height");
        continue;
      }
      figure.style.maxHeight = `${Math.max(1, Math.min(stageBox.width * 1.5, floor - stageBox.top))}px`;
      const { width, height } = figure.getBoundingClientRect();
      const point = projectPaintedSpot(spot, artBox, castBox, stageBox, floor);
      point.bottom = Math.min(
        point.bottom,
        castBox.bottom - stageBox.top - height,
      );
      const half = Math.min(width / 2, stageBox.width / 2);
      const min = stageBox.left - castBox.left + half;
      const max = stageBox.right - castBox.left - half;
      placed.push({ figure, point, min, max });
    }
    // Cropped points can converge at an edge on a phone. Share the available
    // width in painting order so each person remains visible.
    placed.sort((a, b) => a.point.left - b.point.left);
    const gap = placed.length > 1 ? stageBox.width / (placed.length + 1) : 0;
    for (let i = 0; i < placed.length; i++) {
      const { figure, point, min, max } = placed[i];
      const prior = i ? placed[i - 1].left + gap : min;
      placed[i].left = Math.max(
        min,
        Math.min(max, Math.max(point.left, prior)),
      );
    }
    for (let i = placed.length - 2; i >= 0; i--) {
      placed[i].left = Math.max(
        placed[i].min,
        Math.min(placed[i].left, placed[i + 1].left - gap),
      );
    }
    for (const { figure, point, left } of placed) {
      figure.style.left = `${left}px`;
      figure.style.bottom = `${point.bottom}px`;
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }
  const observer = new ResizeObserver(schedule);
  observer.observe(stage);
  observer.observe(art);
  observer.observe(cast);
  return (actors) => {
    spots = new Map(
      actors
        .filter((actor) => actor.paintedSpot)
        .map((actor) => [actor.id, actor.paintedSpot]),
    );
    schedule();
  };
}
