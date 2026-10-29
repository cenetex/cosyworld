// Story definitions use the pack's saved evidence and stable action IDs.
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const keysOk = (value, keys) =>
  record(value) && Object.keys(value).every((key) => keys.includes(key));
const idOk = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const keyOk = (value) =>
  typeof value === "string" &&
  /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/.test(value) &&
  value.length <= 159;
const textOk = (value, max) =>
  typeof value === "string" &&
  value.trim() &&
  value.length <= max &&
  !/[\u0000-\u001f]/.test(value);
const outcomes = ["Fulfilled", "Declined", "Reported", "Shared"];

export function storyQuestProblems(pack, hub) {
  if (pack.storyQuests === undefined) return [];
  const problems = [];
  const check = (ok, message) => {
    if (!ok) problems.push(`${pack.id}: ${message}`);
    return ok;
  };
  if (
    !check(
      Array.isArray(pack.storyQuests) && pack.storyQuests.length <= 128,
      "storyQuests must contain at most 128 definitions",
    )
  )
    return problems;
  const stories = pack.storyQuests;
  const keys = stories.map((story) => story?.key || story?.id);
  check(new Set(keys).size === keys.length, "story quest keys must be unique");
  const actions = new Set((pack.choices || []).map((choice) => choice.id));
  const actors = new Set([
    ...(hub.avatars || []),
    ...Object.keys(pack.avatars || {}),
  ]);
  const places = new Set([
    ...(hub.places || []),
    ...Object.keys(pack.places || {}),
  ]);
  const items = new Set([
    ...(hub.items || []),
    ...Object.keys(pack.items || {}),
  ]);
  const entities = new Set([...actors, ...places, ...items]);
  const branches = new Map(),
    flags = new Set(),
    clearedFlags = new Set();
  for (const choice of pack.choices || [])
    for (const effect of choice.effects || []) {
      if (effect.kind === "set_flag") {
        flags.add(effect.key);
        if (effect.value === false) clearedFlags.add(effect.key);
      }
      if (effect.kind === "choose") {
        if (!branches.has(effect.key)) branches.set(effect.key, new Set());
        branches.get(effect.key).add(effect.value);
      }
    }
  const graph = new Map(keys.map((key) => [key, new Set()]));
  function requirement(rule, owner, depth = 0) {
    if (!record(rule) || depth > 6) return false;
    if (rule.all || rule.any) {
      const name = rule.all ? "all" : "any",
        list = rule[name];
      return (
        keysOk(rule, [name]) &&
        Array.isArray(list) &&
        list.length > 0 &&
        list.length <= 32 &&
        list.every((entry) => requirement(entry, owner, depth + 1))
      );
    }
    switch (rule.kind) {
      case "receipt":
        return keysOk(rule, ["kind", "choice"]) && actions.has(rule.choice);
      case "met":
        return (
          keysOk(rule, ["kind", "actor"]) &&
          Object.hasOwn(pack.avatars || {}, rule.actor)
        );
      case "flag":
        return (
          keysOk(rule, ["kind", "key", "value"]) &&
          flags.has(rule.key) &&
          rule.value === true &&
          !clearedFlags.has(rule.key)
        );
      case "choice":
        return (
          keysOk(rule, ["kind", "key", "value"]) &&
          branches.get(rule.key)?.has(rule.value)
        );
      case "choice_set":
        return keysOk(rule, ["kind", "key"]) && branches.has(rule.key);
      case "quest":
        if (
          !keysOk(rule, ["kind", "key", "status"]) ||
          !keys.includes(rule.key) ||
          !["started", "resolved"].includes(rule.status)
        )
          return false;
        graph.get(owner)?.add(rule.key);
        return true;
      default:
        return false;
    }
  }
  function source(value, owner, depth = 0) {
    if (!record(value) || depth > 6) return false;
    if (value.first || value.earliest || value.latest) {
      const name = value.first
        ? "first"
        : value.earliest
          ? "earliest"
          : "latest";
      const list = value[name];
      return (
        keysOk(value, [name]) &&
        Array.isArray(list) &&
        list.length > 0 &&
        list.length <= 64 &&
        list.every((entry) => source(entry, owner, depth + 1))
      );
    }
    if (value.kind === "choice")
      return keysOk(value, ["kind", "key"]) && branches.has(value.key);
    if (value.kind === "quest") {
      if (!keysOk(value, ["kind", "key"]) || !keys.includes(value.key))
        return false;
      graph.get(owner)?.add(value.key);
      return true;
    }
    return (
      ["receipt", "met"].includes(value.kind) &&
      requirement(value, owner, depth)
    );
  }
  for (const story of stories) {
    const key = story?.key || story?.id;
    const valid = keysOk(story, [
      "id",
      "key",
      "group",
      "line",
      "holder",
      "art",
      "start",
      "progress",
      "endings",
      "defaultEnding",
      "endingOrder",
      "outcome",
      "created",
      "related",
      "when",
      "historicalWhen",
      "keyedCard",
      "return",
    ]);
    check(
      valid &&
        idOk(story?.id) &&
        keyOk(key) &&
        textOk(story?.line, 120) &&
        (story.group === undefined || idOk(story.group)) &&
        keysOk(story.holder, ["kind", "id"]) &&
        (story.holder.kind === "avatar"
          ? actors.has(story.holder.id)
          : story.holder.kind === "place"
            ? places.has(story.holder.id)
            : story.holder.kind === "item" && items.has(story.holder.id)) &&
        entities.has(story.art),
      `story quest ${key} needs a stable key, line, holder and art`,
    );
    if (!record(story)) continue;
    check(
      requirement(story.start, key),
      `story quest ${key} has invalid start requirements`,
    );
    for (const field of ["when", "historicalWhen"])
      if (story[field] !== undefined)
        check(
          requirement(story[field], key),
          `story quest ${key} has invalid ${field} requirements`,
        );
    if (story.created !== undefined)
      check(
        source(story.created, key),
        `story quest ${key} has an invalid created-turn source`,
      );
    if (story.progress !== undefined)
      check(
        Array.isArray(story.progress) &&
          story.progress.length <= 64 &&
          new Set(story.progress).size === story.progress.length &&
          story.progress.every((id) => actions.has(id)),
        `story quest ${key} progress must name distinct choices`,
      );
    check(
      Array.isArray(story.endings) &&
        story.endings.length > 0 &&
        story.endings.length <= 32,
      `story quest ${key} needs bounded endings`,
    );
    if (Array.isArray(story.endings)) {
      check(
        new Set(story.endings.map((ending) => ending?.choice)).size ===
          story.endings.length,
        `story quest ${key} endings must name distinct choices`,
      );
      for (const ending of story.endings)
        check(
          keysOk(ending, ["choice", "when", "outcome"]) &&
            actions.has(ending.choice) &&
            (ending.when === undefined || requirement(ending.when, key)) &&
            (ending.outcome === undefined || outcomes.includes(ending.outcome)),
          `story quest ${key} has an invalid ending`,
        );
      if (story.defaultEnding !== undefined)
        check(
          story.endings.some((ending) => ending.choice === story.defaultEnding),
          `story quest ${key} default ending is unknown`,
        );
    }
    if (story.outcome !== undefined)
      check(
        outcomes.includes(story.outcome),
        `story quest ${key} has an invalid outcome`,
      );
    if (story.endingOrder !== undefined)
      check(
        ["declared", "earliest"].includes(story.endingOrder),
        `story quest ${key} has an invalid ending order`,
      );
    if (story.keyedCard !== undefined)
      check(
        typeof story.keyedCard === "boolean",
        `story quest ${key} keyedCard must be boolean`,
      );
    if (story.related !== undefined)
      check(
        ["ending", "start-and-ending"].includes(story.related) ||
          (Array.isArray(story.related) &&
            story.related.length <= 64 &&
            new Set(story.related).size === story.related.length &&
            story.related.every((id) => actions.has(id))),
        `story quest ${key} related actions must name distinct choices, ending or start-and-ending`,
      );
    if (story.return !== undefined)
      problems.push(
        ...returnProblems(pack, stories, story, key, graph).map(
          (message) => `${pack.id}: story quest ${key} ${message}`,
        ),
      );
  }
  const visited = new Set(),
    pending = new Set();
  const cycle = (key) => {
    if (pending.has(key)) return true;
    if (visited.has(key)) return false;
    pending.add(key);
    for (const next of graph.get(key) || []) if (cycle(next)) return true;
    pending.delete(key);
    visited.add(key);
    return false;
  };
  check(!keys.some(cycle), "story quest requirements contain a cycle");
  return problems;
}

// A return carries an earlier outcome home. `from` names the earlier local
// stories; `carries` names the saved evidence they wrote. Every ending must
// depend on that evidence, directly or through the choices that set it.
const receiptLeaves = (rule) => {
  if (!record(rule)) return [];
  if (rule.all || rule.any)
    return (rule.all || rule.any).flatMap(receiptLeaves);
  return rule.kind === "receipt" ? [rule.choice] : [];
};
const storyChoices = (story) => [
  ...new Set([
    ...receiptLeaves(story.start),
    ...(story.progress || []),
    ...(Array.isArray(story.related) ? story.related : []),
    ...(story.endings || []).map((ending) => ending?.choice),
  ]),
];
const writes = (choice, item) =>
  (item.kind === "receipt" && choice.id === item.choice) ||
  (choice.effects || []).some((effect) =>
    item.kind === "flag"
      ? effect.kind === "set_flag" &&
        effect.key === item.key &&
        effect.value === true
      : item.kind === "choice" &&
        effect.kind === "choose" &&
        effect.key === item.key,
  );

function returnProblems(pack, stories, story, key, graph) {
  const value = story.return,
    problems = [];
  const choices = new Map((pack.choices || []).map((c) => [c.id, c]));
  if (
    !keysOk(value, ["from", "carries"]) ||
    !Array.isArray(value.from) ||
    value.from.length < 1 ||
    value.from.length > 8 ||
    new Set(value.from).size !== value.from.length ||
    !Array.isArray(value.carries) ||
    value.carries.length < 1 ||
    value.carries.length > 8
  )
    return ["return needs from stories and carried evidence"];
  const ownEndings = new Set((story.endings || []).map((e) => e?.choice));
  const departures = [];
  for (const from of value.from) {
    const earlier = stories.find((s) => (s?.key || s?.id) === from);
    if (!earlier || from === key) {
      problems.push(`return names an unknown or self departure ${from}`);
      continue;
    }
    graph.get(key)?.add(from);
    departures.push(earlier);
  }
  const carried = [];
  for (const item of value.carries) {
    const shaped =
      (keysOk(item, ["kind", "key"]) &&
        ["flag", "choice"].includes(item.kind) &&
        idOk(item.key)) ||
      (keysOk(item, ["kind", "choice"]) &&
        item.kind === "receipt" &&
        choices.has(item.choice));
    const writers = shaped
      ? [...choices.values()].filter((c) => writes(c, item))
      : [];
    if (
      !writers.length ||
      writers.some((c) => ownEndings.has(c.id)) ||
      !writers.some((c) =>
        departures.some((d) => storyChoices(d).includes(c.id)),
      )
    ) {
      problems.push(
        "return carries evidence that its departure stories did not write",
      );
      continue;
    }
    carried.push(item);
  }
  for (const earlier of departures)
    if (
      !carried.some((item) =>
        [...choices.values()].some(
          (c) => writes(c, item) && storyChoices(earlier).includes(c.id),
        ),
      )
    )
      problems.push(
        `return cites ${earlier.key || earlier.id} without carrying its outcome`,
      );
  if (!carried.length) return problems;
  // A condition carries an item when it reads it, or when every choice that
  // can satisfy the condition itself depends on the item.
  const memo = new Map();
  const viaSetters = (test, depth) => {
    const setters = [...choices.values()].filter(test);
    return (
      setters.length > 0 && setters.every((c) => dependsChoice(c.id, depth))
    );
  };
  const dependsCondition = (c, depth) => {
    if (!record(c)) return false;
    if (c.kind === "flag" && c.value === true)
      return (
        carried.some((item) => item.kind === "flag" && item.key === c.key) ||
        viaSetters((s) => writes(s, { kind: "flag", key: c.key }), depth)
      );
    if (c.kind === "choice")
      return (
        carried.some((item) => item.kind === "choice" && item.key === c.key) ||
        viaSetters(
          (s) =>
            (s.effects || []).some(
              (e) =>
                e.kind === "choose" && e.key === c.key && e.value === c.value,
            ),
          depth,
        )
      );
    return false;
  };
  function dependsChoice(id, depth) {
    if (carried.some((item) => item.kind === "receipt" && item.choice === id))
      return true;
    if (depth > 8) return false;
    if (memo.has(id)) return memo.get(id);
    memo.set(id, false);
    const choice = choices.get(id);
    const result = Boolean(
      choice &&
        (choice.requires || []).some((c) => dependsCondition(c, depth + 1)),
    );
    memo.set(id, result);
    return result;
  }
  const dependsRule = (rule, depth = 0) => {
    if (!record(rule) || depth > 6) return false;
    if (rule.all) return rule.all.some((r) => dependsRule(r, depth + 1));
    if (rule.any) return rule.any.every((r) => dependsRule(r, depth + 1));
    if (rule.kind === "receipt") return dependsChoice(rule.choice, depth + 1);
    return dependsCondition(rule, depth + 1);
  };
  for (const ending of story.endings || [])
    if (
      !dependsChoice(ending?.choice, 0) &&
      !(ending?.when && dependsRule(ending.when))
    )
      problems.push(
        `return ending ${ending?.choice} does not depend on a carried earlier outcome`,
      );
  return problems;
}
