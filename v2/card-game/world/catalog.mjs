// The authored catalog: places, people, things and their names, shared by the
// browser rules and the shared engine. Split out of world.mjs (#1390).
import forest from "../forest.json" with { type: "json" };
import {
  packPlaces,
  packThings,
  packPeople,
  validatePackLinks,
} from "../pack-registry.mjs";

export const places = { ...forest.places, ...packPlaces };
export const sanctuaries = Object.keys(places).filter(
  (id) => places[id].sanctuary === true,
);
export const people = { ...forest.people, ...packPeople };
export const things = { ...packThings, ...forest.things };
validatePackLinks(places, people, things);

export const nameOf = (id) =>
  places[id]?.name || people[id]?.name || things[id]?.name || "the world";
