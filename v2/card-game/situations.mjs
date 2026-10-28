import {
  humanAvatarIds,
  controlledByHuman,
  humanPresent,
} from "./human-cast.mjs";
// Target hands can ask for an item's use or its place in someone else's hand.
// These conditions use the same items and card plays as the rest of the world.
import {
  isPackActor,
  entityActive,
  packThings,
  packPeople,
} from "./pack-registry.mjs";
export const condition = (kind, item, extra = {}) => ({
  conditions: [{ kind, item, ...extra }],
});
export const rootOwner = (s, item) => {
  let owner = s.items[item].holder;
  const seen = new Set([item]);
  while (s.items[owner]) {
    if (seen.has(owner)) throw new Error("An item holds itself.");
    seen.add(owner);
    owner = s.items[owner].holder;
  }
  return owner;
};
// A friendly companion can keep an item while it serves a shared quest.
// Custody rules for card plays and explicit deliveries still use rootOwner.
export function questItemAvailable(s, actor, item) {
  const owner = rootOwner(s, item);
  if (owner === actor) return true;
  return Boolean(
    s.life &&
      s.actors[owner] &&
      (!controlledByHuman(s, owner) || humanPresent(s, owner)) &&
      (!s.opening ||
        s.opening.met[owner] !== undefined ||
        s.controlledActors?.includes(owner)) &&
      s.actors[owner].place === s.actors[actor].place &&
      ![actor, owner].some((id) =>
        (s.motives?.grievances[id] || []).some(
          (g) => g.other === (id === actor ? owner : actor) && g.weight > 0,
        ),
      ),
  );
}
export function conditionMet(s, c) {
  switch (c.kind) {
    case "together":
      return c.avatars.every(
        (id) =>
          (!controlledByHuman(s, id) || humanPresent(s, id)) &&
          s.actors[id].place === s.actors[c.avatars[0]].place,
      );
    case "lit":
      return (
        entityActive(s, "lamp") &&
        s.items.lamp.lit &&
        s.items.lamp.fuel > 0 &&
        s.items.cloth.holder !== "lamp"
      );
    case "ringing":
      return (
        entityActive(s, "bell") &&
        s.items.bell.ringing > 0 &&
        s.items.cloth.holder !== "bell"
      );
    case "covered":
      return s.items.cloth.holder === c.item;
    case "heldBy":
      return rootOwner(s, c.item) === c.avatar;
    default:
      return false;
  }
}
export function conditionText(c, name) {
  if (c.kind === "together")
    return `${c.avatars.map(name).join(" and ")} together`;
  return {
    lit: `${name(c.item)} alight`,
    ringing: `${name(c.item)} ringing`,
    covered: `${name(c.item)} under the cloth`,
    heldBy: `${name(c.avatar)} holds ${name(c.item)}`,
  }[c.kind];
}
const profilesId = (id) =>
  [...humanAvatarIds, "moth", "keeper", ...Object.keys(packPeople)].includes(
    id,
  );
export function validCondition(c, actor) {
  return (
    c &&
    ((c.kind === "together" &&
      Array.isArray(c.avatars) &&
      c.avatars.length === 2 &&
      new Set(c.avatars).size === 2 &&
      c.avatars.every((id) => profilesId(id) && id !== actor)) ||
      (c.kind === "lit" && c.item === "lamp") ||
      (c.kind === "ringing" && c.item === "bell") ||
      (c.kind === "covered" && ["lamp", "bell"].includes(c.item)) ||
      (c.kind === "heldBy" &&
        ["lamp", "oil", "bell", "cloth", ...Object.keys(packThings)].includes(
          c.item,
        ) &&
        [...humanAvatarIds, "moth", "keeper"].includes(c.avatar) &&
        c.avatar !== actor))
  );
}
export const validConsequence = (c, actor) =>
  c &&
  (["anchor", "oil", "hush"].includes(c.kind) ||
    (c.kind === "trust" &&
      [...humanAvatarIds, "moth", "keeper"].includes(c.avatar) &&
      c.avatar !== actor));
export function requiredItems(s, actor, target) {
  const items = [...target.items];
  for (const c of target.conditions || []) {
    if (conditionMet(s, c) || c.kind === "together") continue;
    items.push(c.item);
    if (c.kind === "covered") items.push("cloth");
    if (c.kind === "lit" && s.items.lamp.fuel === 0)
      items.push(s.items.oil.doses ? "oil" : "bell");
  }
  return [...new Set(items)];
}

// Choose a situation from real custody, resources, company and past programs.
// A stalled resident still uses the short independent errands in quests.mjs.
export function situationPrograms(s, actor, base, api) {
  const {
    hand,
    hold,
    at,
    withAvatars,
    either,
    available,
    needed,
    reachable,
    mayGive = () => true,
  } = api;
  const own = (item) => rootOwner(s, item) === actor;
  const canGet = (item) => available(item);
  const partner = base.generated.partner;
  const result = (h, consequence) => ({ ...h, consequence });
  const make = (kind, name, purpose, steps, companion = partner) => ({
    ...base,
    name,
    purpose,
    steps,
    generated: {
      ...base.generated,
      item: steps[0].items[0],
      owner: rootOwner(s, steps[0].items[0]),
      partner: companion,
      situation: kind,
    },
  });
  const choices = [];
  if (
    !s.locations?.attic.anchored &&
    reachable.includes("attic") &&
    reachable.includes("pond") &&
    canGet("lamp") &&
    (s.items.lamp.fuel > 0 || (s.items.oil.doses > 0 && canGet("oil")))
  ) {
    choices.push(
      make(
        "crossing",
        "A path that remembers",
        "Carry the light through the mirror and leave a memory of the crossing.",
        [
          hand(
            hold("lamp"),
            at("attic"),
            withAvatars(partner),
            condition("lit", "lamp"),
          ),
          result(hand(hold("lamp"), at("pond"), withAvatars(partner)), {
            kind: "anchor",
          }),
        ],
      ),
    );
  }
  if (reachable.includes("pond") && canGet("bell")) {
    const call = result(
      hand(
        hold("bell"),
        at("pond"),
        withAvatars(partner),
        condition("ringing", "bell"),
      ),
      { kind: "oil" },
    );
    const hush = result(
      hand(
        hold("bell", "cloth"),
        at("pond"),
        withAvatars(partner),
        condition("covered", "bell"),
      ),
      { kind: "hush" },
    );
    const answers = [
      ...(s.items.oil.doses < 3 ? [call] : []),
      ...(canGet("cloth") && s.locations?.pond.answer !== "hush" ? [hush] : []),
    ];
    if (answers.length)
      choices.push(
        make(
          "answer",
          answers.length === 1 && answers[0] === hush
            ? "A quiet shore"
            : "An answer from below",
          answers.length === 2
            ? "Ring at the pond to refill the oil flask, or wrap the bell there to make the shore a refuge until it rings again."
            : answers[0] === call
              ? "Ring at the pond to refill the oil flask."
              : "Wrap the bell at the pond to make the shore a refuge until it rings again.",
          [hand(hold("bell"), at("station")), either(...answers)],
        ),
      );
  }
  const others = Object.keys(s.actors)
    .filter((id) => id !== actor && !isPackActor(id) && entityActive(s, id))
    .sort(
      (a, b) =>
        Number(s.actors[b].place === s.actors[actor].place) -
        Number(s.actors[a].place === s.actors[actor].place),
    )
    .slice(0, 2);
  // Vale chooses handovers through card plays. Residents can arrange care
  // between themselves while a player decides whether to take an offer.
  const caretakers = others.filter(
    (id) => controlledByHuman(s, actor) || !controlledByHuman(s, id),
  );
  const deliveries = caretakers.flatMap((avatar) =>
    needed(avatar)
      .filter((item) => own(item) && mayGive(item))
      .map((item) => ({ avatar, item })),
  );
  // A recent gift supplies a reason to return a useful item to that person.
  const gift = s.log.findLast(
    (e) => e.verb === "give" && e.targetId === actor && e.actorId !== actor,
  );
  deliveries.sort(
    (a, b) =>
      Number(b.avatar === gift?.actorId) - Number(a.avatar === gift?.actorId),
  );
  for (const delivery of deliveries) {
    const { avatar, item } = delivery;
    const place = s.actors[avatar].place;
    if (reachable.includes(place))
      choices.push(
        make(
          "delivery",
          gift?.actorId === avatar ? "Return a kindness" : "A lightened load",
          `Bring the ${api.name(item)} to ${api.name(avatar)} and let them hold it. They will remember the help when you ask for company or a spare.`,
          [
            hand(hold(item), at(place), withAvatars(avatar)),
            result(
              hand(
                at(place),
                withAvatars(avatar),
                condition("heldBy", item, { avatar }),
              ),
              { kind: "trust", avatar },
            ),
          ],
          avatar,
        ),
      );
  }
  if (
    reachable.includes("station") &&
    caretakers.length > 0 &&
    canGet("lamp") &&
    (!own("lamp") || mayGive("lamp")) &&
    (s.items.lamp.fuel > 0 || (s.items.oil.doses > 0 && canGet("oil")))
  ) {
    choices.push(
      make(
        "gathering",
        "Keep a light for everyone",
        "Bring everyone to the station around a lit lamp, then leave it in someone else's care. That person will remember your help.",
        [
          hand(
            hold("lamp"),
            at("station"),
            withAvatars(...others),
            condition("lit", "lamp"),
          ),
          either(
            ...caretakers.map((avatar) =>
              result(
                hand(
                  at("station"),
                  withAvatars(avatar),
                  condition("heldBy", "lamp", { avatar }),
                ),
                { kind: "trust", avatar },
              ),
            ),
          ),
        ],
      ),
    );
  }
  return choices;
}
