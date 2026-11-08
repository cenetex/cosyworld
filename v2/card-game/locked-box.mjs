// A card locked behind a quest lies in the hand as a carved wooden box: the
// card back, its painting and name hidden. Its closed lid keeps the contents
// concealed, while selection can show the authored quest needed to open it.
// Once the rules open the way, the box turns over once, with the
// same lift as an uncovered card (card-reveal.mjs), and the card shows as
// itself from then on. Presentation only: it reads the committed world and
// never touches rules, saves, the journal or sync.
import { sealedReason, sealedAvatar } from "./cards.mjs";
import {
  conditionsMet,
  packDefinitions,
  packThings,
  transports,
} from "./pack-registry.mjs";
import { questCaption, questVerb } from "./quest-card.mjs";
import { lockedAt } from "./pack-items.mjs";
import { laneConditions } from "./pack-transport.mjs";
import { currentActor, rootHolder, sealedWays } from "./world.mjs";

export const CLOSED_BOX = "A closed box.";
export const LOCKED_BOX = "A locked box.";
export function lockedQuest(world, id, known = () => false) {
  if (!isLockedBox(world, id)) return null;
  const preview = sealedAvatar(world, id);
  if (preview) return { text: preview.reason, cards: [] };
  const actor = currentActor(world);
  const way = sealedWays(world, actor).find((route) => route.to === id);
  const route =
    way &&
    packDefinitions
      .flatMap((pack) => (pack.routes || []).map((route) => ({ pack, route })))
      .find(
        ({ route }) =>
          (route.from === way.from && route.to === id) ||
          (way.guardedBy && route.from === id && route.to === way.from),
      );
  const goal =
    way?.sealed?.quest ||
    conditionGoal(
      world,
      route?.pack.id,
      route?.route.travelerRequires,
      actor,
    ) ||
    conditionGoal(world, route?.pack.id, route?.route.requires, actor) ||
    laneGoal(world, world.actors[actor]?.place, id, actor) ||
    craftedGoal(world, id, actor);
  if (!goal) return { text: LOCKED_BOX, cards: [] };
  const quest = {
    actor,
    kind: goal.kind,
    target: goal.target,
    ...(goal.step ? { step: goal.step } : {}),
  };
  const text = questCaption(quest, false, questVerb(world, quest), known);
  return { text, cards: [] };
}

function conditionGoal(world, packId, conditions, actor) {
  if (!conditions) return null;
  for (const condition of Array.isArray(conditions)
    ? conditions
    : [conditions]) {
    if (packId && conditionsMet(world, packId, [condition], actor)) continue;
    if (condition.kind === "any") {
      const goal = conditionGoal(world, packId, condition.conditions, actor);
      if (goal) return goal;
    }
    if (condition.kind === "talked")
      return { kind: "person", target: condition.person };
    if (condition.kind === "holding" && condition.actor) {
      return {
        kind: "item",
        target: condition.item,
        step: { verb: "give", to: condition.actor },
      };
    }
    if (condition.kind === "holding" && condition.role === "actor")
      return { kind: "item", target: condition.item };
    if (["item_near", "item_at", "item_present"].includes(condition.kind)) {
      return {
        kind: "item",
        target: condition.item,
        ...(condition.place
          ? { step: { verb: "bring", at: condition.place } }
          : {}),
      };
    }
  }
  return null;
}

function laneGoal(world, from, to, actor) {
  const entry = Object.entries(transports).find(
    ([id, ship]) => ship.place === from || ship.docks.includes(from),
  );
  if (!entry) return null;
  const [id, transport] = entry;
  const dock = transport.place === from ? world.transports?.[id]?.dock : from;
  return dock
    ? conditionGoal(world, transport.packId, laneConditions(dock, to), actor)
    : null;
}

function craftedGoal(world, id, actor) {
  const item = packThings[id];
  if (!item?.locked || !lockedAt(world, item.home).includes(id)) return null;
  const { by, consumes } = item.locked;
  const held = consumes.find(
    (ingredient) => rootHolder(world, ingredient) === actor,
  );
  if (held)
    return { kind: "item", target: held, step: { verb: "give", to: by } };
  const missing = consumes.find(
    (ingredient) => ![by, item.home].includes(rootHolder(world, ingredient)),
  );
  if (missing)
    return {
      kind: "item",
      target: missing,
      step: { verb: "bring", at: item.home },
    };
  return null;
}

// The locked carved lid has a recessed iron keyhole (assets/README.md).
export const LOCKED_BACK = "./assets/card-back-locked.webp";

// Whether the card is still locked behind its quest for this player.
export const isLockedBox = (world, id) => sealedReason(world, id) !== null;

// Boxes this view has drawn. `draw(shown, locked)` takes the cards in view
// now and the cards drawn locked now (in view or tucked in a stack), and
// returns the ones due to turn over: drawn locked before, in view and open
// now. Each turns once; a redraw never covers it again. A box that leaves
// the hand still locked turns when it is next seen open.
export function createLockedBoxes() {
  const boxed = new Set();
  return {
    draw(shown, locked) {
      const shut = new Set(locked);
      for (const id of shut) boxed.add(id);
      return shown.filter((id) => !shut.has(id) && boxed.delete(id));
    },
    boxed: (id) => boxed.has(id),
    clear: () => boxed.clear(),
  };
}
