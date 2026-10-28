import { questCarried } from "./quest-hands.mjs";
import {
  collectionCards,
  questRecord,
  questRecords,
  focusedQuest,
  clearQuestFocus,
  pruneSharedQuestHistory,
} from "./shared-quests.mjs";
import { hasQuestPrograms } from "./motives.mjs";
import {
  knownActors,
  programFor,
  desireFor,
  alternatives,
  recordQuestProgress,
} from "./quests.mjs";
import { lifeOf, questActive, finishPersonalQuest, hopeOf } from "./life.mjs";
import { isPackActor, entityActive } from "./pack-registry.mjs";

// The same match records the current step and exact world evidence for every card.
export function captureQuestStep(s, met, card, { handStatus, fulfillment }) {
  if (met.has(card.key)) return false;
  const target = alternatives(card.program?.steps[card.step]).find(
    (hand) => handStatus(s, card.actor, hand).met,
  );
  if (!target) return false;
  met.set(card.key, {
    actor: card.actor,
    questKey: card.questKey,
    ...(card.shared ? { shared: true } : {}),
    capturedSeq: s.eventSeq || 0,
    step: card.step,
    target: structuredClone(target),
    fulfillment: fulfillment(s, card.actor, target),
  });
  return true;
}

// Capture each fulfilled hand before another actor can leave or move an item.
// All held cards share one capture map, so each keeps one step per round.
export function captureQuestHands(s, met, { actorIds, handStatus }) {
  if (!hasQuestPrograms(s)) return;
  const capture = (actor, card, shared = false) =>
    captureQuestStep(
      s,
      met,
      {
        key: shared ? card.key : card.key ? `${actor}/${card.key}` : actor,
        actor,
        questKey: card.key,
        shared,
        program: card.program,
        step: card.step,
      },
      {
        handStatus,
        fulfillment: (world, id, target) => ({
          items: [...target.items],
          location: world.actors[id].place,
          ...(shared
            ? {
                avatars: [...target.avatars],
                participants: [...new Set([id, ...target.avatars])].sort(),
              }
            : {
                // Required people come first; nearby witnesses keep the saved bound.
                avatars: [
                  ...new Set([
                    ...target.avatars,
                    ...actorIds.filter(
                      (other) =>
                        other !== id &&
                        entityActive(world, other) &&
                        world.actors[other].place === world.actors[id].place,
                    ),
                  ]),
                ]
                  .slice(0, 2)
                  .sort((a, b) => actorIds.indexOf(a) - actorIds.indexOf(b)),
              }),
          ...((target.conditions || []).length
            ? { conditions: handStatus(world, id, target).conditions }
            : {}),
        }),
      },
    );
  for (const actor of knownActors(s).filter((id) => !isPackActor(id))) {
    const collection = lifeOf(s, actor)?.collection;
    const cards = collection
      ? collectionCards(s, actor).filter(
          (q) =>
            q.completedTurn === null &&
            (questCarried(s, actor, q.key) ||
              q.participants.some((id) => questCarried(s, id, q.key))),
        )
      : [
          {
            key: null,
            program: programFor(s, actor),
            step: s.actors[actor].progress.step,
          },
        ];
    for (const card of cards) capture(actor, card);
  }
  for (const quest of questRecords(s).filter(
    (q) => q.mode === "shared" && q.completedTurn === null && !q.retired,
  )) {
    if (met.has(quest.key)) continue;
    const candidates = quest.subjectActor
      ? [quest.subjectActor]
      : quest.participants;
    for (const actor of actorIds.filter(
      (id) =>
        candidates.includes(id) &&
        entityActive(s, id) &&
        questCarried(s, id, quest.key),
    ))
      if (capture(actor, quest, true)) break;
  }
}

// Resolve a saved match against the current record before changing progress.
export function questStepTransition(record, evidence, turn) {
  if (
    !record?.program ||
    record.completedTurn != null ||
    record.retired ||
    record.lastProgressTurn === turn ||
    record.step !== evidence.step ||
    record.step < 0 ||
    record.step >= record.program.steps.length
  )
    return null;
  return {
    step: record.step,
    nextStep: record.step + 1,
    complete: record.step + 1 === record.program.steps.length,
  };
}

const consequenceKey = (effect, actor) =>
  JSON.stringify([effect, effect.kind === "trust" ? actor : null]);

export function advanceQuestPrograms(
  s,
  met,
  { applyConsequence, ensurePrograms, sanctuaries, nameOf, handText, addLog },
) {
  if (!hasQuestPrograms(s)) return [];
  const receipts = [],
    completions = [];
  const consequences = new Set(
    s.log
      .filter((entry) => entry.turn === s.turn && entry.consequence)
      .map((entry) => consequenceKey(entry.consequence, entry.actorId)),
  );
  const applyOnce = (evidence) => {
    const effect = evidence.target.consequence;
    if (!effect) return;
    const key = consequenceKey(effect, evidence.actor);
    if (consequences.has(key)) return;
    applyConsequence(s, evidence.actor, evidence.target);
    consequences.add(key);
  };
  const captured = [...met.values()].sort(
    (a, b) =>
      a.capturedSeq - b.capturedSeq ||
      ((a.questKey || a.actor) < (b.questKey || b.actor)
        ? -1
        : (a.questKey || a.actor) > (b.questKey || b.actor)
          ? 1
          : 0),
  );
  for (const evidence of captured) {
    const actor = evidence.actor;
    const progress = s.actors[actor].progress;
    const collection = lifeOf(s, actor)?.collection;
    const card = evidence.shared
      ? questRecord(s, evidence.questKey)
      : collection &&
        collectionCards(s, actor).find((q) => q.key === evidence.questKey);
    const record =
      card ||
      (!evidence.shared && !collection
        ? {
            program: programFor(s, actor),
            step: progress.step,
            lastProgressTurn: progress.marks.at(-1),
          }
        : null);
    const transition = questStepTransition(record, evidence, s.turn);
    if (!transition) continue;
    const { step, nextStep, complete } = transition;
    if (evidence.shared) {
      const quest = card;
      quest.step = nextStep;
      quest.lastProgressTurn = s.turn;
      if (complete) {
        quest.completedTurn = s.turn;
        clearQuestFocus(s, quest.key);
        applyOnce(evidence);
      }
      addLog(
        s,
        "World",
        `${nameOf(actor)} ${complete ? "completes" : "helps with"} ${quest.program.name}.`,
        {
          kind: "quest",
          questMode: "shared",
          program: structuredClone(quest.program),
          actorId: actor,
          locationId: evidence.fulfillment.location,
          questKey: quest.key,
          programId: quest.program.id,
          step: evidence.step,
          target: evidence.target,
          fulfillment: evidence.fulfillment,
        },
      );
      if (complete) {
        completions.push({
          questKey: quest.key,
          capturedSeq: evidence.capturedSeq,
          actorId: actor,
          locationId: evidence.fulfillment.location,
          participants: evidence.fulfillment.participants,
          outcome: "fulfilled",
        });
        pruneSharedQuestHistory(s, quest.holder, quest.key);
      }
      continue;
    }
    const source = record.program;
    const programIndex = progress.program;
    const program = source.generated
      ? {
          ...source,
          id: `generated-${actor}-${programIndex + 1}`,
          generated: { ...source.generated, level: programIndex + 1 },
        }
      : source;
    const focused = focusedQuest(s, actor);
    const wasActive =
      !collection ||
      (collection.active === card.key &&
        (!focused || focused.key === card.key));
    progress.marks.push(s.turn);
    progress.marks = progress.marks.slice(-32);
    if (collection) recordQuestProgress(s, actor, complete, card.key);
    else progress.step = nextStep;
    if (complete) {
      finishPersonalQuest(s, actor, program, sanctuaries, {
        rest: wasActive || !collection?.active,
      });
      applyOnce(evidence);
      if (collection) progress.completedHands = collection.earned;
      if (program.generated) {
        if (!collection) progress.completedHands += program.steps.length;
        if (program.generated.item)
          progress.recent = [
            ...(progress.recent || []),
            program.generated.item,
          ].slice(-4);
        progress.recentKinds = [
          ...(progress.recentKinds || []),
          program.generated.situation || "bargain",
        ].slice(-4);
        if (wasActive) delete progress.current;
      }
      progress.program += 1;
      if (wasActive) progress.step = 0;
    }
    receipts.push({
      actor,
      program,
      step,
      programIndex,
      complete,
      ...evidence,
    });
  }
  ensurePrograms(s);
  for (const {
    actor,
    program,
    step,
    programIndex,
    complete,
    target,
    fulfillment,
    questKey,
    capturedSeq,
  } of receipts) {
    let text = `${nameOf(actor)} completes hand ${step + 1}/${program.steps.length} of ${program.name}.`;
    if (complete) text += ` Level ${programIndex + 2}.`;
    const life = lifeOf(s, actor);
    if (complete && life?.milestones.at(-1) === s.turn)
      text += ` Hope milestone: ${hopeOf(s, actor).milestones[life.milestones.length - 1].title}.`;
    text += questActive(s, actor)
      ? ` Next: ${handText(desireFor(s, actor))}.`
      : lifeOf(s, actor)?.phase === "returning"
        ? ` Next: rest at ${nameOf(lifeOf(s, actor).restAt)}.`
        : " Time to rest and enjoy it.";
    addLog(s, "World", text, {
      kind: "quest",
      actorId: actor,
      programId: program.id,
      program: structuredClone(program),
      programIndex,
      ...(questKey ? { questKey } : {}),
      target,
      fulfillment,
      step,
      level: programIndex + 1 + Number(complete),
    });
    if (complete && questKey) {
      const quest = questRecord(s, questKey);
      if (quest)
        completions.push({
          questKey,
          capturedSeq,
          actorId: actor,
          locationId: fulfillment.location,
          participants: [actor, ...target.avatars],
          outcome: "fulfilled",
        });
    }
  }
  return completions;
}
