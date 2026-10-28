import { sectionAllows } from "./pack-sections.mjs";

// A fixed scene role leaves after its authored witness report is committed.
export function retirementTurn(world, pack, actor) {
  const after = pack?.avatars[actor]?.retireAfter;
  const turn = after && world.packs?.[pack.id]?.receipts?.[after];
  return Number.isSafeInteger(turn) && turn >= 1 ? turn : null;
}

export function retireAfterReport(world, pack, choice, text) {
  for (const [id, avatar] of Object.entries(pack.avatars)) {
    if (avatar.retireAfter !== choice.id) continue;
    const place = world.actors[id].place;
    for (const item of Object.values(world.items)) {
      if (item.holder !== id) continue;
      item.holder = place;
      item.history.push(
        `${text} ${avatar.name}’s carried belongings rest at ${pack.places[place].name}.`.slice(
          0,
          400,
        ),
      );
      item.history = item.history.slice(-12);
    }
  }
}

// A meeting on the report's turn belongs to the earlier appearance on that
// turn. Opening conditions must already hold before that report commits.
export function validRetiredMeeting(world, pack, actor, met, conditionsMet) {
  const retired = retirementTurn(world, pack, actor);
  if (
    retired === null ||
    !Number.isSafeInteger(met) ||
    met < 0 ||
    met > retired
  )
    return false;
  const saved = world.packs[pack.id];
  const choices = {},
    flags = {};
  const projection = {
    ...world,
    packs: { ...world.packs, [pack.id]: { ...saved, choices, flags } },
  };
  const authored = new Map(pack.choices.map((choice) => [choice.id, choice]));
  for (const [id, turn] of Object.entries(saved.receipts).sort(
    (a, b) => a[1] - b[1],
  )) {
    if (turn > met) break;
    if (id === pack.avatars[actor].retireAfter) continue;
    for (const effect of authored.get(id)?.effects || []) {
      if (effect.kind === "choose") choices[effect.key] = effect.value;
      if (effect.kind === "set_flag") flags[effect.key] = effect.value;
    }
  }
  return (
    conditionsMet(projection, pack.id, pack.avatars[actor].requires || []) &&
    sectionAllows(projection, pack, actor, conditionsMet)
  );
}
