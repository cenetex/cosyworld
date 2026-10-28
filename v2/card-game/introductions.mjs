import { humanAvatar, humanPresent } from "./human-cast.mjs";

export const introductionPair = (program) =>
  program?.generated?.situation === "introduction"
    ? program.generated.pair
    : null;

export function introductionPrograms(world, actor, base, candidates, name) {
  const others = candidates.filter((id) => id !== actor);
  const previous = Object.values(world.quests?.records || {})
    .filter(
      (q) =>
        q.subjectActor === actor &&
        q.completedTurn !== null &&
        introductionPair(q.program),
    )
    .sort((a, b) => b.completedTurn - a.completedTurn);
  const signature = (pair) => [...pair].sort().join(":");
  const pairs = others.flatMap((a, index) =>
    others
      .slice(index + 1)
      .filter(
        (b) =>
          ![a, b].every(
            (id) => world.actors[id].place === world.actors[actor].place,
          ),
      )
      .map((b) => [a, b]),
  );
  pairs.sort((a, b) => {
    const score = (pair) =>
      previous.reduce(
        (n, q, index) =>
          n +
          (signature(pair) === signature(introductionPair(q.program))
            ? 1 + (index === 0 ? 100 : 0)
            : 0),
        0,
      );
    return score(a) - score(b);
  });
  const pair = pairs[0];
  return pair
    ? [
        {
          ...base,
          name: `Get ${name(pair[0])} and ${name(pair[1])} together`.slice(
            0,
            100,
          ),
          purpose:
            `Help ${name(pair[0])} and ${name(pair[1])} meet. Visit them in turn.`.slice(
              0,
              240,
            ),
          art: actor,
          steps: [
            {
              items: [],
              location: null,
              avatars: [],
              conditions: [{ kind: "together", avatars: pair }],
            },
          ],
          generated: {
            ...base.generated,
            item: null,
            owner: actor,
            partner: pair[0],
            situation: "introduction",
            pair,
          },
        },
      ]
    : [];
}

export function introductionTarget(world, actor, key, program) {
  const pair = introductionPair(program);
  if (!pair) return null;
  if (pair.some((id) => humanAvatar(id) && !humanPresent(world, id)))
    return null;
  if (pair.every((id) => world.actors[id].place === world.actors[actor].place))
    return null;
  const visit = world.introductionVisits?.[actor];
  if (visit?.quest === key && pair.includes(visit.next))
    return world.actors[visit.next].place === world.actors[actor].place
      ? pair.find((id) => id !== visit.next)
      : visit.next;
  return (
    pair.find((id) => world.actors[id].place !== world.actors[actor].place) ||
    pair[0]
  );
}

export function introductionPlan(
  world,
  actor,
  key,
  program,
  { actions, toward, name },
) {
  const pair = introductionPair(program);
  const target = introductionTarget(world, actor, key, program);
  const wait = actions.find((a) => a.kind === "wait");
  if (!target)
    return {
      action: wait,
      reason: `Give ${pair.map(name).join(" and ")} time to meet.`,
    };
  const seen = world.memories[actor].seen?.[target];
  const searched =
    world.introductionVisits?.[actor]?.quest === key
      ? world.introductionVisits[actor].searched || {}
      : {};
  const remembered =
    seen &&
    seen.place !== world.actors[actor].place &&
    (searched[seen.place] ?? -1) <= seen.turn &&
    toward(seen.place);
  return {
    action:
      remembered ||
      actions
        .filter((a) => a.kind === "move")
        .sort(
          (a, b) => (searched[a.target] ?? -1) - (searched[b.target] ?? -1),
        )[0] ||
      wait,
    reason: `Look for ${name(target)} and help ${pair.map(name).join(" and ")} meet.`,
  };
}

export function validIntroductionProgram(program) {
  const pair = introductionPair(program);
  if (!pair) return program.generated?.situation !== "introduction";
  const step = program.steps?.[0];
  return (
    Array.isArray(pair) &&
    pair.length === 2 &&
    program.steps.length === 1 &&
    step &&
    !step.any &&
    step.items.length === 0 &&
    step.location === null &&
    step.avatars.length === 0 &&
    step.conditions?.length === 1 &&
    step.conditions[0].kind === "together" &&
    step.conditions[0].avatars.length === 2 &&
    pair.every((id) => step.conditions[0].avatars.includes(id))
  );
}

export function recordIntroductionTurn(world, actor, key, program, target) {
  const pair = introductionPair(program);
  if (!pair || !target) return;
  world.introductionVisits ??= {};
  world.introductionVisits[actor] = {
    quest: key,
    next:
      world.actors[actor].place === world.actors[target].place
        ? pair.find((id) => id !== target)
        : target,
    turn: world.turn,
    searched: {
      ...(world.introductionVisits[actor]?.quest === key
        ? world.introductionVisits[actor].searched || {}
        : {}),
      [world.actors[actor].place]: world.turn,
    },
  };
}

export function validIntroductionVisits(world, actorIds, placeIds) {
  const visits = world.introductionVisits;
  return (
    visits === undefined ||
    Boolean(
      visits &&
        typeof visits === "object" &&
        !Array.isArray(visits) &&
        Object.entries(visits).every(
          ([actor, v]) =>
            actorIds.includes(actor) &&
            v &&
            Object.keys(v).every((key) =>
              ["quest", "next", "turn", "searched"].includes(key),
            ) &&
            typeof v.quest === "string" &&
            v.quest.length > 0 &&
            v.quest.length <= 100 &&
            actorIds.includes(v.next) &&
            v.next !== actor &&
            Number.isSafeInteger(v.turn) &&
            v.turn >= 0 &&
            v.turn <= world.turn &&
            v.searched &&
            typeof v.searched === "object" &&
            !Array.isArray(v.searched) &&
            Object.entries(v.searched).every(
              ([place, turn]) =>
                placeIds.includes(place) &&
                Number.isSafeInteger(turn) &&
                turn >= 0 &&
                turn <= world.turn,
            ),
        ),
    )
  );
}
