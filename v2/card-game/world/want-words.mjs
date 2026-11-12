import { consumable } from "../pack-registry.mjs";
import { nameOf, people, places } from "./catalog.mjs";

export const UNKNOWN = {
  item: "something you haven't found",
  person: "someone you haven't met",
  place: "somewhere you haven't discovered",
};
export const SEEK = {
  item: "find something",
  person: "meet someone",
  place: "discover somewhere",
};
export const kindOf = (id) =>
  people[id] ? "person" : places[id] ? "place" : "item";
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
 * place. `cards` stands in for the table's cards (tests word made-up ones).
 */
export function wantWords(
  want,
  known = () => true,
  { approach = null, cards = TABLE } = {},
) {
  if (!want) return "nothing in particular";
  if (want.kind === "connect") return "introduce two people";
  const name = (id) => (known(id) ? cards.name(id) : UNKNOWN[cards.kind(id)]);
  const list = (ids) => [...new Set(ids.map(name))].join(", ");
  const near = (word, id) =>
    known(id) || cards.kind(id) !== "place" ? `${word} ${name(id)}` : name(id);
  const step = want.step,
    what = name(want.target),
    cold = !known(want.target),
    verb = step?.verb === "attack" ? "strike" : step?.verb,
    act =
      cold && SEEK[want.kind]?.startsWith(`${verb} `)
        ? SEEK[want.kind]
        : `${verb} ${what}`;
  if (step?.verb === "lay")
    return `lay ${list(step.items)} ${near("in", want.target)}`;
  if (step?.verb === "give") return `give ${what} to ${name(step.to)}`;
  if (step?.verb === "eat")
    return `${cards.drink(want.target) ? "drink" : "eat"} ${what}${step.with ? ` with ${name(step.with)}` : ""}${step.at ? ` ${near("at", step.at)}` : ""}`;
  if (step?.verb === "bring" && want.kind === "person")
    return `bring ${what} ${near("to", step.at ?? step.to)}`;
  if (step?.verb === "bring")
    return `${cold ? `${SEEK.item}, and bring it` : `bring ${what}`} ${
      step.to
        ? `to ${name(step.to)} ${near("at", step.at)}`
        : near("to", step.at)
    }`;
  if (step?.at) return `${act} ${near("at", step.at)}`;
  if (step?.verb === "rest")
    return approach && !cold
      ? `${approach} ${what} and rest there`
      : `rest ${near("at", want.target)}`;
  if (step) return act;
  if (cold) return SEEK[want.kind] ?? SEEK.person;
  if (want.kind === "item")
    return `hold ${want.lit === undefined ? "" : want.lit ? "the lit " : "the dark "}${what}`;
  if (want.kind === "place") return `${approach ?? "go to"} ${what}`;
  return `talk with ${what}`;
}
