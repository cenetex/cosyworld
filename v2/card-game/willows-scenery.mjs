import { locationDaylight } from "./daylight.mjs";

const art = (name) => `assets/willows/${name}.webp`;
export const willowsAssets = [
  "camp-out-day",
  "camp-lit-night",
  "camp-out-night",
  "landing-ship-night",
  "swede-listening",
  "swede-worried",
  "swede-seated",
].map(art);
export const willowsFireLit = (world) =>
  !world?.packs?.willows?.flags?.["willows-fire-out"];

export function willowsBackdrop(world, id, file) {
  if (!world) return file;
  const night = locationDaylight(world, id)?.phase === "night";
  if (id === "willows-landing" && night) return art("landing-ship-night");
  if (id === "willows-camp") {
    if (night)
      return art(willowsFireLit(world) ? "camp-lit-night" : "camp-out-night");
    if (!willowsFireLit(world)) return art("camp-out-day");
  }
  return file;
}

export function willowsPortrait(world, id) {
  if (!world || id !== "willows-swede") return null;
  const flags = world.packs?.willows?.flags || {};
  const response = world.packs?.willows?.choices?.["willows-response"];
  if (response === "watch") return art("swede-listening");
  if (flags["willows-signs-shared"]) return art("swede-worried");
  if (
    flags["willows-humming-heard"] ||
    locationDaylight(world, "willows-camp")?.phase === "night"
  )
    return art("swede-listening");
  return willowsFireLit(world) ? art("swede-seated") : art("swede");
}

export function willowsSceneFacts(world, id) {
  if (id !== "willows-camp" && id !== "willows-swede") return [];
  return [
    willowsFireLit(world)
      ? "The campfire is lit. Its warmth reaches the tent and the Swede."
      : "The campfire is out. Cold ash and dark logs lie inside the stone ring.",
  ];
}

export const willowsScale = (world, id) =>
  willowsPortrait(world, id) === art("swede-seated") ? 0.58 : 1;
