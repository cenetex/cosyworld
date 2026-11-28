// Authored game entities shared by the browser and server rules (#1390).
import arcana from "../arcana.json" with { type: "json" };
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
export const arcanaCards = Object.fromEntries(
  arcana.cards.map((card) => [card.id, card]),
);
validatePackLinks(places, people, things);

export const nameOf = (id) =>
  places[id]?.name ||
  people[id]?.name ||
  things[id]?.name ||
  arcanaCards[id]?.name ||
  "the world";
const NAMED = /^(?:The|An?) |^\p{L}+['’]s? /u;
export const theName = (id) =>
  NAMED.test(nameOf(id)) ? nameOf(id) : `the ${nameOf(id)}`;
export const ownName = (owner, id) =>
  /^['’]/u.test(nameOf(id).slice(nameOf(owner).length)) &&
  nameOf(id).startsWith(nameOf(owner))
    ? nameOf(id)
    : `${nameOf(owner)}’s ${nameOf(id)}`;
