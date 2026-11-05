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
    for (const figure of cast.children) {
      const spot = spots.get(figure.dataset.avatar);
      if (!spot) {
        figure.style.removeProperty("left");
        figure.style.removeProperty("bottom");
        continue;
      }
      const point = projectPaintedSpot(
        spot,
        artBox,
        castBox,
        stageBox,
        stageBox.bottom - 12,
      );
      figure.style.left = `${point.left}px`;
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
