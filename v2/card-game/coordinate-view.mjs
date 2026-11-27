import { observatoryCoordinates } from "./world/elysium-coordinates.mjs";

const rings = ["outer", "middle", "inner"];

export function renderCoordinateReadout(output, world, actor, onCurrentScene) {
  const coordinates = onCurrentScene
    ? observatoryCoordinates(world, actor)
    : null;
  if (coordinates) {
    for (const ring of rings) {
      const digit = output.querySelector(`[data-coordinate="${ring}"] b`);
      const text = String(coordinates[ring] ?? "?");
      if (digit.textContent !== text) digit.textContent = text;
    }
    output
      .querySelector("[data-coordinate-status]")
      .toggleAttribute("hidden", !coordinates.aligned);
    output.toggleAttribute("data-aligned", coordinates.aligned);
  }
  output.toggleAttribute("hidden", !coordinates);
}
