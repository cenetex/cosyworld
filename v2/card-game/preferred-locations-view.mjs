import { projectPaintedSpot } from "./preferred-locations.mjs";

// The existing painting box follows focus, aspect ratio, and cover cropping.
export function createPreferredLocationsView(stage, art, cast) {
  let spots = new Map();
  let frame = 0;
  let originalFocus = "0.5";
  function draw() {
    frame = 0;
    const stageBox = stage.getBoundingClientRect();
    let artBox = art.getBoundingClientRect();
    if (spots.size && stageBox.width < 701 && artBox.width > stageBox.width) {
      const middle =
        [...spots.values()].reduce((sum, spot) => sum + spot[0], 0) /
        spots.size /
        100;
      const focus =
        (stageBox.width / 2 - artBox.width * middle) /
        (stageBox.width - artBox.width);
      stage.style.setProperty(
        "--focus-x",
        String(Math.max(0, Math.min(1, focus))),
      );
      artBox = art.getBoundingClientRect();
    } else {
      stage.style.setProperty("--focus-x", originalFocus);
      artBox = art.getBoundingClientRect();
    }
    const castBox = cast.getBoundingClientRect();
    const floor = stageBox.bottom - 12;
    const dockTop = document
      .querySelector(".play-dock")
      .getBoundingClientRect().top;
    const placed = [];
    for (const figure of cast.children) {
      const spot = spots.get(figure.dataset.avatar);
      if (!spot) {
        figure.style.removeProperty("left");
        figure.style.removeProperty("bottom");
        figure.style.removeProperty("max-height");
        figure.style.removeProperty("min-height");
        continue;
      }
      const maxHeight = Math.max(
        1,
        Math.min(
          (stageBox.width * 1.5) /
            (stageBox.width < 701 ? Math.min(spots.size, 3) : 1),
          floor - stageBox.top,
        ),
      );
      figure.style.maxHeight = `${maxHeight}px`;
      figure.style.minHeight = `${Math.min(maxHeight, stageBox.height * 0.4, 140)}px`;
      const { width, height } = figure.getBoundingClientRect();
      const point = projectPaintedSpot(spot, artBox, castBox, stageBox, floor);
      point.bottom = Math.max(
        point.bottom,
        castBox.bottom - dockTop + 12 - height * 0.7,
      );
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
    originalFocus = stage.style.getPropertyValue("--focus-x") || "0.5";
    spots = new Map(
      actors
        .filter((actor) => actor.paintedSpot)
        .map((actor) => [actor.id, actor.paintedSpot]),
    );
    schedule();
  };
}
