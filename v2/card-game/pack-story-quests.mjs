// Authored stories read saved evidence. Their cards keep stable identities while
// the pack's choices continue to own deeds, branches and object custody.
const owns = (value, key) => value && Object.hasOwn(value, key);
const storyKey = (pack, story) => `${pack.id}:${story.key || story.id}`;
const stateOf = (world, pack) => world.packs?.[pack.id];

function evidenceTurn(world, pack, source, resolve) {
  const state = stateOf(world, pack);
  if (source.first || source.earliest || source.latest) {
    const mode = source.first
      ? "first"
      : source.earliest
        ? "earliest"
        : "latest";
    const turns = source[mode]
      .map((entry) => evidenceTurn(world, pack, entry, resolve))
      .filter((turn) => turn !== null);
    if (!turns.length) return null;
    return mode === "first"
      ? turns[0]
      : mode === "earliest"
        ? Math.min(...turns)
        : Math.max(...turns);
  }
  if (source.kind === "receipt")
    return state?.receipts?.[source.choice] ?? null;
  if (source.kind === "met") return state?.met?.[source.actor] ?? null;
  if (source.kind === "quest") return resolve(source.key)?.createdTurn ?? null;
  if (source.kind === "choice") {
    const value = state?.choices?.[source.key];
    const action = pack.choices?.find((choice) =>
      choice.effects.some(
        (effect) =>
          effect.kind === "choose" &&
          effect.key === source.key &&
          effect.value === value,
      ),
    );
    return action ? (state?.receipts?.[action.id] ?? null) : null;
  }
  return null;
}

function requirementMet(world, pack, rule, resolve) {
  if (rule.all)
    return rule.all.every((entry) =>
      requirementMet(world, pack, entry, resolve),
    );
  if (rule.any)
    return rule.any.some((entry) =>
      requirementMet(world, pack, entry, resolve),
    );
  const state = stateOf(world, pack);
  switch (rule.kind) {
    case "receipt":
      return owns(state?.receipts, rule.choice);
    case "met":
      return owns(state?.met, rule.actor);
    case "flag":
      return (state?.flags?.[rule.key] ?? false) === rule.value;
    case "choice":
      return state?.choices?.[rule.key] === rule.value;
    case "choice_set":
      return owns(state?.choices, rule.key);
    case "quest": {
      const quest = resolve(rule.key);
      return Boolean(quest && (rule.status === "started" || quest.resolved));
    }
    default:
      return false;
  }
}

function sourceChoices(rule) {
  if (!rule) return [];
  if (rule.all || rule.any)
    return (rule.all || rule.any).flatMap(sourceChoices);
  return rule.kind === "receipt" ? [rule.choice] : [];
}

function startSources(pack, rule) {
  if (rule.all || rule.any)
    return (rule.all || rule.any).flatMap((entry) => startSources(pack, entry));
  if (["receipt", "met"].includes(rule.kind)) return [rule];
  if (["choice", "choice_set", "quest"].includes(rule.kind))
    return [
      {
        kind: rule.kind === "choice_set" ? "choice" : rule.kind,
        key: rule.key,
      },
    ];
  if (rule.kind === "flag")
    return (pack.choices || [])
      .filter((choice) =>
        choice.effects.some(
          (effect) =>
            effect.kind === "set_flag" &&
            effect.key === rule.key &&
            effect.value === rule.value,
        ),
      )
      .map((choice) => ({ kind: "receipt", choice: choice.id }));
  return [];
}

export function authoredStoryIds(packs, group = null) {
  return [
    ...new Set(
      packs.flatMap((pack) =>
        (pack.storyQuests || [])
          .filter((story) => group === null || story.group === group)
          .map((story) => story.id),
      ),
    ),
  ];
}

export function authoredStoryDefinitions(
  world,
  packs,
  { history = false, group = null } = {},
) {
  return packs.flatMap((pack) => {
    if (!stateOf(world, pack)) return [];
    const stories = pack.storyQuests || [];
    const cache = new Map(),
      visiting = new Set();
    const resolve = (key) => {
      if (cache.has(key)) return cache.get(key);
      // The validator rejects cycles; this also bounds unchecked test data.
      if (visiting.has(key)) return null;
      const story = stories.find((entry) => (entry.key || entry.id) === key);
      if (!story) return null;
      visiting.add(key);
      const met = (rule) => requirementMet(world, pack, rule, resolve);
      let definition = null;
      if ((!story.when || met(story.when)) && met(story.start)) {
        const state = stateOf(world, pack);
        const endings = story.endings.filter(
          (ending) => !ending.when || met(ending.when),
        );
        const completed = endings.filter((ending) =>
          owns(state.receipts, ending.choice),
        );
        if (story.endingOrder === "earliest")
          completed.sort(
            (a, b) => state.receipts[a.choice] - state.receipts[b.choice],
          );
        const ending =
          completed[0] ||
          endings.find((entry) => entry.choice === story.defaultEnding) ||
          endings[0] ||
          story.endings.find((entry) => entry.choice === story.defaultEnding) ||
          story.endings[0];
        if (ending) {
          const created = story.created || {
            earliest: [
              ...startSources(pack, story.start),
              ...[
                ...(story.progress || []),
                ...story.endings.map((entry) => entry.choice),
              ].map((choice) => ({ kind: "receipt", choice })),
            ],
          };
          definition = {
            id: story.id,
            key: storyKey(pack, story),
            ...(story.keyedCard !== undefined
              ? { keyedCard: story.keyedCard }
              : {}),
            title: story.line,
            purpose: story.line,
            singleLine: true,
            story: true,
            status: completed.length ? "fulfilled" : "pending",
            art: story.art,
            resolved: completed.length > 0,
            completion: ending.outcome || story.outcome || "Fulfilled",
            holder: { ...story.holder },
            choiceId: ending.choice,
            createdTurn: evidenceTurn(world, pack, created, resolve) ?? 0,
            ...(story.historicalWhen && met(story.historicalWhen)
              ? { historical: true }
              : {}),
          };
        }
      }
      visiting.delete(key);
      cache.set(key, definition);
      return definition;
    };
    return stories
      .filter((story) => group === null || story.group === group)
      .map((story) => resolve(story.key || story.id))
      .filter(
        (definition) => definition && (history || !definition.historical),
      );
  });
}

export function authoredStoryRelated(packs, definition, event) {
  const pack = packs.find((entry) => definition.key.startsWith(`${entry.id}:`));
  const story = pack?.storyQuests?.find(
    (entry) => storyKey(pack, entry) === definition.key,
  );
  if (!story || event.packId !== pack.id) return false;
  const related =
    story.related === "ending"
      ? [definition.choiceId]
      : story.related === "start-and-ending"
        ? [...sourceChoices(story.start), definition.choiceId]
        : story.related || [
            ...sourceChoices(story.start),
            ...(story.progress || []),
            ...story.endings.map((entry) => entry.choice),
          ];
  return related.includes(event.choiceId);
}
