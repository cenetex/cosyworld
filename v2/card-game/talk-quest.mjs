// Talk gives a quest (#2196, rules 99). A player's Talk that reveals the
// other avatar's top want, new to the player, gives the player an ordinary
// quest to meet it with them:
//   their item X   -> give(X, them):     the item, step give to them;
//   their place P  -> bring(them, P):    the person, step bring at P;
//   their person Q -> introduce(them, Q): the person, step bring to Q.
// The quest is read from its own shape, so the stack holds no extra record;
// `heard` keeps, per avatar, the last want the player was told. A quest whose
// want has since changed leaves at the next settle, not as a refusal. Met,
// it is a want met like any other, so it counts toward the gap of ordinary
// wants between level quests.
import { allQuestsOf, nextWant, pushQuest, questTerms, setQuests } from "./want.mjs";
import { revealed } from "./want-talk.mjs";

const key = (want) => `${want.kind}:${want.target}`;

// The avatar a quest serves, when Talk gave it: null for any other quest.
export function talkQuestFrom(w) {
  if (!w?.step || w.quest || w.story) return null;
  if (w.kind === "item" && w.step.verb === "give") return w.step.to;
  if (w.kind === "person" && w.step.verb === "bring") return w.target;
  return null;
}
// The want of theirs a Talk quest serves.
function served(w) {
  if (w.kind === "item") return { kind: "item", target: w.target };
  return w.step.at
    ? { kind: "place", target: w.step.at }
    : { kind: "person", target: w.step.to };
}
// The quest that meets this want of theirs, or null for a want Talk gives
// no quest for.
export function questFor(s, them, want) {
  const base = { since: s.turn, refusals: 0 };
  // Their wish to eat or drink something somewhere is the player's to meet
  // there too (rules 102): "eat the Travel Provisions at Piraeus Quays".
  // A wish to eat with no place asks for the thing, as any item want.
  if (want.kind === "item" && want.step?.verb === "eat" && want.step.at)
    return {
      kind: "item",
      target: want.target,
      ...base,
      step: { verb: "eat", at: want.step.at },
    };
  if (want.kind === "item")
    return {
      kind: "item",
      target: want.target,
      ...base,
      step: { verb: "give", to: them },
    };
  if (want.step?.verb === "lay")
    return { ...base, kind: "place", target: want.target, step: want.step };
  if (want.kind === "place")
    return {
      kind: "person",
      target: them,
      ...base,
      step: { verb: "bring", at: want.target },
    };
  if (want.kind === "person")
    return {
      kind: "person",
      target: them,
      ...base,
      step: { verb: "bring", to: want.target },
    };
  return null;
}

// A player's Talk with `them`: their top want, if Talk reveals it and the
// player has not been told it by them before, becomes a quest. One already
// held keeps its place. New quests join the saved queue and preserve focus.
export function talkQuest(s, actor, them, api) {
  const a = s.actors[actor],
    want = s.actors[them]?.want;
  if (!api.player(actor) || them === actor || !want) return null;
  const quest = revealed(s, them, want) && questFor(s, them, want);
  if (!quest || a.heard?.[them] === key(want)) return null;
  const held = allQuestsOf(s, actor);
  // A level quest's step that is this very quest already asks it.
  if (held.some((w) => w.quest && questTerms(w) === questTerms(quest))) return null;
  const top = pushQuest(s, actor, quest);
  a.heard = { ...a.heard, [them]: key(want) };
  return top;
}

// A Talk quest whose want they no longer hold on top, met by someone else
// or set aside, leaves the player's stack. Nothing is refused: a quest left
// with none beneath draws the next.
export function pruneTalkQuests(s, api) {
  for (const id of Object.keys(s.actors)) {
    if (!api.player(id)) continue;
    const list = allQuestsOf(s, id);
    const kept = list.filter((w) => {
      const them = talkQuestFrom(w);
      if (!them) return true;
      const want = s.actors[them]?.want,
        wanted = served(w);
      return want?.kind === wanted.kind && want.target === wanted.target;
    });
    if (kept.length === list.length) continue;
    setQuests(s.actors[id], kept);
    if (!s.actors[id].want)
      setQuests(s.actors[id], [nextWant(s, id, api)].filter(Boolean));
  }
}
