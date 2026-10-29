import { describe, expect, it } from "vitest";
import source from "../v2/content/lonely-forest/card-world.json" with { type: "json" };
import bridge from "../v2/worlds/lonely-forest/card-bridge.json" with { type: "json" };
import table from "../v2/worlds/card-table.json" with { type: "json" };
import { packProblems, packCompositionProblems } from "../v2/card-game/pack-schema.mjs";
import { personalQuestProblems } from "../v2/card-game/pack-personal-quest-schema.mjs";

function pack() {
  const { schemaVersion, pack: _pack, id, description, ...join } = bridge;
  return structuredClone({ ...source, bridge: { id, description }, ...join });
}
const issues = (value) => personalQuestProblems(value, table.hub).join(" ");

describe("authored per-player quest schema", () => {
  it("validates all eight source rows through the common pack validator", () => {
    const value = pack();
    expect(value.personalQuests[0].playerItems).toHaveLength(8);
    expect(personalQuestProblems(value, table.hub)).toEqual([]);
    expect(packProblems(value, table.hub)).toEqual([]);
  });

  it("accepts authored hub search locations outside the host room", () => {
    const value = pack();
    value.personalQuests[0].locations = ["forest-garden", "attic", "station", "pond"];
    expect(personalQuestProblems(value, table.hub)).toEqual([]);
  });

  it("keeps metadata optional for another authored quest", () => {
    const value = pack();
    delete value.personalQuests[0].legacy;
    delete value.personalQuests[0].sharedCompletion;
    expect(personalQuestProblems(value, table.hub)).toEqual([]);
    delete value.personalQuests;
    expect(personalQuestProblems(value, table.hub)).toEqual([]);
    expect(packProblems(value, table.hub)).toEqual([]);
  });

  it.each([
    ["non-list", (p) => { p.personalQuests = {}; }],
    ["null record", (p) => { p.personalQuests = [null]; }],
    ["too many definitions", (p) => { p.personalQuests = Array(9).fill(p.personalQuests[0]); }],
    ["duplicate id", (p) => { p.personalQuests.push(structuredClone(p.personalQuests[0])); }],
    ["unknown quest key", (_, q) => { q.unknown = true; }],
    ["missing quest key", (_, q) => { delete q.host; }],
    ["human host", (_, q) => { q.host = "vale"; }],
    ["missing host", (_, q) => { q.host = "missing"; }],
    ["moving host", (p) => { p.avatars.rati.travels = true; }],
    ["journey host", (p) => { p.avatars.rati.journey = {}; }],
    ["retiring host", (p) => { p.avatars.rati.retireAfter = "forest-mend-scarf"; }],
    ["wrong host room", (_, q) => { q.at = "forest-garden"; }],
    ["host room in locations", (_, q) => { q.locations.push(q.at); }],
    ["empty locations", (_, q) => { q.locations = []; }],
    ["unknown location", (_, q) => { q.locations.push("missing-place"); }],
    ["duplicate location", (_, q) => { q.locations.push(q.locations[0]); }],
    ["too many locations", (_, q) => { q.locations = Array(129).fill("forest-garden"); }],
    ["non-list locations", (_, q) => { q.locations = {}; }],
    ["empty players", (_, q) => { q.playerItems = []; }],
    ["too many players", (_, q) => { q.playerItems.push(q.playerItems[0]); }],
    ["non-list players", (_, q) => { q.playerItems = {}; }],
    ["unknown row field", (_, q) => { q.playerItems[0].hidden = true; }],
    ["missing row field", (_, q) => { delete q.playerItems[0].reward; }],
    ["resident player", (_, q) => { q.playerItems[0].player = "moth"; }],
    ["duplicate player", (_, q) => { q.playerItems[1].player = q.playerItems[0].player; }],
    ["unknown button", (_, q) => { q.playerItems[0].button = "made-up-button"; }],
    ["hub item button", (_, q) => { q.playerItems[0].button = "lamp"; }],
    ["same button and reward", (_, q) => { q.playerItems[0].reward = q.playerItems[0].button; }],
    ["shared button", (_, q) => { q.playerItems[1].button = q.playerItems[0].button; }],
    ["shared reward", (_, q) => { q.playerItems[1].reward = q.playerItems[0].reward; }],
    ["unknown shared choice", (_, q) => { q.sharedCompletion = "missing-choice"; }],
    ["other choice subject", (p, q) => { p.choices.find(c => c.id === q.sharedCompletion).subject = "oak"; }],
    ["other choice room", (p, q) => { p.choices.find(c => c.id === q.sharedCompletion).at = "forest-garden"; }],
    ["repeatable choice", (p, q) => { p.choices.find(c => c.id === q.sharedCompletion).repeatable = true; }],
    ["missing meeting guard", (p, q) => { p.choices.find(c => c.id === q.sharedCompletion).requires = []; }],
    ["wrong meeting guard", (p, q) => { p.choices.find(c => c.id === q.sharedCompletion).requires[0].actor = "oak"; }],
    ["item-moving completion", (p, q) => { p.choices.find(c => c.id === q.sharedCompletion).effects = [{kind:"place_item",item:q.playerItems[0].button,place:q.at}]; }],
    ["negative completion flag", (p, q) => { p.choices.find(c => c.id === q.sharedCompletion).effects[0].value = false; }],
    ["empty legacy", (_, q) => { q.legacy = {}; }],
    ["unknown legacy key", (_, q) => { q.legacy.extra = true; }],
    ["missing legacy item", (_, q) => { q.legacy.item = "missing-item"; }],
    ["missing legacy choice", (_, q) => { q.legacy.choice = "missing-choice"; }],
    ["missing legacy story", (_, q) => { q.legacy.story = "missing-story"; }],
    ["wrong legacy holder", (p, q) => { p.storyQuests.find(s => s.id === q.legacy.story).holder = {kind:"avatar",id:"oak"}; }],
    ["repeatable legacy choice", (p, q) => { p.choices.find(c => c.id === q.legacy.choice).repeatable = true; }],
    ["wrong legacy ending", (_, q) => { q.legacy.story = "story-quest-forest-path"; }],
    ["personal item as legacy", (_, q) => { q.legacy.item = q.playerItems[0].button; }],
  ])("rejects %s", (_, mutate) => {
    const value = pack(); mutate(value, value.personalQuests[0]);
    expect(personalQuestProblems(value, table.hub).length).toBeGreaterThan(0);
    expect(packProblems(value, table.hub).length).toBeGreaterThan(0);
  });

  it("rejects an item reused by another personal definition", () => {
    const value = pack(), another = structuredClone(value.personalQuests[0]);
    another.id = "another-personal-quest";
    delete another.sharedCompletion; delete another.legacy;
    value.personalQuests.push(another);
    expect(issues(value)).toContain("distinct human and pack-owned item references");
  });

  it("checks a shared completion identity once per definition", () => {
    const value = pack(), another = structuredClone(value.personalQuests[0]);
    another.id = "another-personal-quest";
    another.playerItems = [{ player: "vale", button: "another-button", reward: "another-reward" }];
    delete another.legacy;
    value.items["another-button"] = { ...value.items[another.playerItems[0].button], holder:"forest-garden" };
    value.items["another-reward"] = { holder:"rati" };
    value.personalQuests.push(another);
    expect(issues(value)).toContain("sharedCompletion");
  });

  it("checks personal identities across mounted pack composition", () => {
    const value = pack(), other = structuredClone(value); other.id = "another-pack";
    expect(packCompositionProblems([value, other]).join(" ")).toContain("personal quest forest-rati-scarf");
    other.personalQuests[0].id = "another-personal-quest";
    expect(packCompositionProblems([value, other]).filter((issue) => issue.includes("personal quest"))).toEqual([]);
  });
});
