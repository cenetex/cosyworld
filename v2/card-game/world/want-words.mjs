// The one wording of a want (rules 133). Every lock, every offered quest and
// every held quest is shown as this and nothing else: a fixed verb, then the
// cards the want concerns by name. Nothing here is authored per pack; the
// rules own the verbs, and a name is shown only for what the traveler has
// discovered. "Find something you haven't discovered yet" is a want like any
// other, so an undiscovered card is worded as unknown, never as an error.
import { consumable } from "../pack-registry.mjs";
import { nameOf, people, places, things } from "./catalog.mjs";

// What an undiscovered card is called, one short phrase for each kind of card
// (items, avatars and places are all persons of the table: only the kind of
// card differs).
export const UNKNOWN = {
  item: "something undiscovered",
  person: "someone you have not met",
  place: "a place you have not found",
};
export const kindOf = (id) =>
  people[id] ? "person" : places[id] ? "place" : "item";
// The table's cards: how to name one, what kind it is, whether it is drunk.
const TABLE = {
  name: nameOf,
  kind: kindOf,
  drink: (id) => consumable(id) === "drink",
};

/**
 * Several wants said together, joined plainly: the first begins the
 * sentence, the rest follow "and". `say(want)` words one, capitalized.
 */
export const joinWants = (wants, say) =>
  wants
    .map((want, i) => {
      const words = say(want);
      return i ? words[0].toLowerCase() + words.slice(1) : words;
    })
    .join(" and ");

/**
 * A want in words, lower case, from its structure:
 * `{kind, target, step?, lit?}`. `known(id)` says whether the traveler has
 * discovered the card; the default shows every name (history and rules).
 * `approach` ("discover" or "go to") is the card's own verb for reaching a
 * place; a place not yet discovered is always "reach". `cards` stands in for
 * the table's cards (tests word made-up ones).
 */
export function wantWords(
  want,
  known = () => true,
  { approach = null, cards = TABLE } = {},
) {
  if (!want) return "nothing in particular";
  if (want.kind === "connect") return "introduce two people";
  const name = (id) => (known(id) ? cards.name(id) : UNKNOWN[cards.kind(id)]);
  // Several unknown items read once ("something undiscovered").
  const list = (ids) => [...new Set(ids.map(name))].join(", ");
  const step = want.step,
    what = name(want.target),
    cold = !known(want.target),
    // Players see Strike for the attack play.
    verb = step?.verb === "attack" ? "strike" : step?.verb;
  if (step?.verb === "lay") return `lay ${list(step.items)} in ${what}`;
  if (step?.verb === "give") return `give ${what} to ${name(step.to)}`;
  // Eat or drink one, with someone, somewhere (rules 102).
  if (step?.verb === "eat")
    return `${cards.drink(want.target) ? "drink" : "eat"} ${what}${step.with ? ` with ${name(step.with)}` : ""}${step.at ? ` at ${name(step.at)}` : ""}`;
  // Talk's quest to bring a person somewhere, or to someone (rules 99).
  if (step?.verb === "bring" && want.kind === "person")
    return `bring ${what} to ${name(step.at ?? step.to)}`;
  if (step?.verb === "bring")
    return step.to
      ? `bring ${what} to ${name(step.to)} at ${name(step.at)}`
      : `bring ${what} home to ${name(step.at)}`;
  if (step?.at) return `${verb} ${what} at ${name(step.at)}`;
  if (step?.verb === "rest")
    return approach && !cold
      ? `${approach} ${what} and rest there`
      : `rest at ${what}`;
  if (step) return `${verb} ${what}`;
  if (want.kind === "item")
    return `${cold ? "find" : "hold"} ${want.lit === undefined || cold ? "" : want.lit ? "the lit " : "the dark "}${what}`;
  if (want.kind === "place")
    return `${cold ? "reach" : (approach ?? "go to")} ${what}`;
  if (want.kind === "connect") return "introduce two people";
  return `${cold ? "find" : "talk with"} ${what}`;
}
