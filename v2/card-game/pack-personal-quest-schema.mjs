import { humanAvatarIds } from "./human-cast.mjs";

const record = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const owns = (value, key) => record(value) && typeof key === "string" && Object.hasOwn(value, key);
const id = (value) => typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const exact = (value, required, optional = []) => record(value) &&
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => [...required, ...optional].includes(key));

// Definitions bind a fixed host, real items and a bounded human roster. Runtime
// callbacks choose among these locations using the actual open routes.
export function personalQuestProblems(pack, hub) {
  if (pack?.personalQuests === undefined) return [];
  const problems = [];
  const check = (ok, message) => {
    if (!ok) problems.push(`${pack?.id || "pack"}: ${message}`);
    return ok;
  };
  if (!check(Array.isArray(pack.personalQuests) && pack.personalQuests.length <= 8 &&
    pack.personalQuests.every(record), "personalQuests must contain at most eight records")) return problems;
  const quests = new Set(), bindings = new Set(), completions = new Set(), legacyItems = new Set(),
    legacyChoices = new Set(), legacyStories = new Set();
  const places = { ...Object.fromEntries((hub?.places || []).map((place) => [place, true])),
    ...(pack.places || {}) };
  const choices = Array.isArray(pack.choices) ? pack.choices : [];
  const stories = Array.isArray(pack.storyQuests) ? pack.storyQuests : [];
  for (const quest of pack.personalQuests) {
    if (!check(exact(quest, ["id", "host", "at", "locations", "playerItems"],
      ["sharedCompletion", "legacy"]) && id(quest.id) && !quests.has(quest.id),
    "personal quest needs exact fields and a distinct stable id")) continue;
    quests.add(quest.id);
    const host = pack.avatars?.[quest.host];
    check(id(quest.host) && record(host) && !humanAvatarIds.includes(quest.host) &&
      owns(pack.places, quest.at) && host.place === quest.at && host.travels === false &&
      host.journey === undefined && host.retireAfter === undefined,
    `personal quest ${quest.id} needs a fixed resident at its authored host room`);
    check(Array.isArray(quest.locations) && quest.locations.length > 0 && quest.locations.length <= 128 &&
      new Set(quest.locations).size === quest.locations.length &&
      quest.locations.every((place) => id(place) && owns(places, place) && place !== quest.at),
    `personal quest ${quest.id} needs distinct eligible location ids outside its host room`);
    if (!check(Array.isArray(quest.playerItems) && quest.playerItems.length > 0 &&
      quest.playerItems.length <= humanAvatarIds.length && quest.playerItems.every(record),
    `personal quest ${quest.id} needs one to eight player item rows`)) continue;
    const players = new Set();
    for (const row of quest.playerItems) {
      const valid = exact(row, ["player", "button", "reward"]) &&
        humanAvatarIds.includes(row.player) && !players.has(row.player) &&
        id(row.button) && id(row.reward) && row.button !== row.reward &&
        owns(pack.items, row.button) && owns(pack.items, row.reward) &&
        !bindings.has(row.button) && !bindings.has(row.reward);
      check(valid, `personal quest ${quest.id} needs distinct human and pack-owned item references`);
      players.add(row.player);
      bindings.add(row.button); bindings.add(row.reward);
    }
    if (quest.sharedCompletion !== undefined) {
      const choice = choices.find((entry) => entry.id === quest.sharedCompletion);
      check(id(quest.sharedCompletion) && !completions.has(quest.sharedCompletion) &&
        record(choice) && choice.subject === quest.host && choice.at === quest.at &&
        choice.repeatable !== true && Array.isArray(choice.requires) &&
        choice.requires.length === 1 && choice.requires[0]?.kind === "met" &&
        choice.requires[0]?.actor === quest.host && Array.isArray(choice.effects) &&
        choice.effects.length > 0 && choice.effects.every((effect) =>
          exact(effect, ["kind", "key", "value"]) && effect.kind === "set_flag" &&
          id(effect.key) && effect.value === true),
      `personal quest ${quest.id} sharedCompletion needs its own once-only host choice and positive shared flags`);
      completions.add(quest.sharedCompletion);
    }
    if (quest.legacy !== undefined) {
      const legacy = quest.legacy;
      if (!check(exact(legacy, ["item", "choice", "story"]) &&
        [legacy.item, legacy.choice, legacy.story].every(id),
      `personal quest ${quest.id} legacy needs exact item, choice and story references`)) continue;
      const choice = choices.find((entry) => entry.id === legacy.choice);
      const story = stories.find((entry) => entry.id === legacy.story);
      check(owns(pack.items, legacy.item) && !legacyItems.has(legacy.item) &&
        record(choice) && choice.subject === quest.host && choice.at === quest.at &&
        choice.repeatable !== true && !legacyChoices.has(legacy.choice) && !legacyStories.has(legacy.story) &&
        choice.id !== quest.sharedCompletion && Array.isArray(choice.requires) &&
        choice.requires.some((condition) => condition.kind === "holding" && condition.item === legacy.item) &&
        record(story) && ((story.holder?.kind === "avatar" && story.holder.id === quest.host) ||
          (story.holder?.kind === "item" && story.holder.id === legacy.item)) &&
        Array.isArray(story.endings) &&
        story.endings.some((ending) => ending.choice === legacy.choice),
      `personal quest ${quest.id} legacy must bind its old item, host choice and matching story ending`);
      legacyItems.add(legacy.item); legacyChoices.add(legacy.choice); legacyStories.add(legacy.story);
    }
  }
  check([...legacyItems].every((item) => !bindings.has(item)),
    "personal quest items must keep separate legacy identities");
  return problems;
}
