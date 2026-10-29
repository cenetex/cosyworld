import { describe, expect, it } from "vitest";
import compiled from "../v2/card-game/packs.json" with { type: "json" };
import {
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import {
  storyQuestProblems,
  storyQuestWarnings,
} from "../v2/card-game/pack-story-schema.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { questRecord } from "../v2/card-game/shared-quests.mjs";
import {
  storyDefinitions,
  syncStoryQuests,
} from "../v2/card-game/story-quests.mjs";
import { playOpenDoor } from "./helpers/open-door.mjs";
import {
  ajaxCamp,
  ajaxChoice,
  ajaxMove,
  ajaxState,
  ajaxTalk,
} from "./helpers/greek-ajax.mjs";

const greek = packDefinition("greek-drama");
const forest = packDefinition("lonely-forest");
const mounted = compiled.packs.flatMap((p) => Object.keys(p.places));
const reload = (world) => decodeSave(encodeSave(world));
const SHIELD = "greek-drama:story-quest-greek-ajax-shield";
const offered = (world, id) =>
  legalActions(world).some((a) => a.choiceId === id);
const copy = (pack) => structuredClone(pack);
const storyOf = (pack, key) =>
  pack.storyQuests.find((s) => (s.key || s.id) === key);

describe("story returns", () => {
  it("marks each homecoming as a return that carries an earlier outcome", () => {
    const returns = greek.storyQuests
      .filter((s) => s.return)
      .map((s) => s.key || s.id);
    expect(returns).toEqual([
      "story-quest-greek-courtyard:grave",
      "story-quest-greek-courtyard",
      "story-quest-greek-open-door-return",
      "story-quest-greek-homecoming-return:agora",
      "story-quest-greek-homecoming-return:eleusis",
      "story-quest-greek-homecoming-return:piraeus",
      "story-quest-greek-homecoming-return:colonus",
      "story-quest-greek-homecoming-return:marathon",
      "story-quest-greek-homecoming-witness",
    ]);
    expect(forest.storyQuests.filter((s) => s.return).map((s) => s.id)).toEqual(
      ["story-quest-forest-homecoming"],
    );
    for (const pack of [greek, forest])
      expect(storyQuestProblems(pack, compiled.hub)).toEqual([]);
  });

  it("rejects a return whose ending ignores what it carries", () => {
    const pack = copy(forest);
    const homecoming = storyOf(pack, "story-quest-forest-homecoming");
    const leave = pack.choices.find((c) => c.id === "forest-leave-charm");
    leave.requires = leave.requires.filter((c) => c.key !== "forest-oak-heard");
    expect(storyQuestProblems(pack, compiled.hub)).toEqual([
      "lonely-forest: story quest story-quest-forest-homecoming return ending forest-leave-charm does not depend on a carried earlier outcome",
    ]);
    expect(homecoming.return.carries).toHaveLength(2);
  });

  it("rejects carried evidence the departure did not write", () => {
    const pack = copy(greek);
    storyOf(pack, "story-quest-greek-homecoming-witness").return.carries = [
      { kind: "choice", key: "greek-open-door-recovery" },
    ];
    expect(storyQuestProblems(pack, compiled.hub)).toEqual(
      expect.arrayContaining([
        "greek-drama: story quest story-quest-greek-homecoming-witness return carries evidence that its departure stories did not write",
      ]),
    );
  });

  it("rejects a return that departs from itself or carries its own ending", () => {
    const pack = copy(greek);
    const story = storyOf(pack, "story-quest-greek-homecoming-return:agora");
    story.return = {
      from: ["story-quest-greek-homecoming-return:agora"],
      carries: [{ kind: "flag", key: "greek-homecoming-agora-reported" }],
    };
    const problems = storyQuestProblems(pack, compiled.hub);
    expect(problems.join("\n")).toMatch(/unknown or self departure/);
    expect(problems.join("\n")).toMatch(/did not write/);
    story.return = { from: [], carries: [] };
    expect(storyQuestProblems(pack, compiled.hub).join("\n")).toMatch(
      /needs from stories and carried evidence/,
    );
  });

  it("follows carried evidence through the choices that set it", () => {
    // Oak's account needs the mended scarf, so the charm endings carry it
    // even though they read only the oak-heard flag.
    const pack = copy(forest);
    const homecoming = storyOf(pack, "story-quest-forest-homecoming");
    homecoming.return.carries = [{ kind: "flag", key: "forest-scarf-mended" }];
    expect(storyQuestProblems(pack, compiled.hub)).toEqual([
      "lonely-forest: story quest story-quest-forest-homecoming return cites story-quest-forest-path without carrying its outcome",
    ]);
    homecoming.return.from = ["story-quest-forest-hearth"];
    expect(storyQuestProblems(pack, compiled.hub)).toEqual([]);
  });
});

describe("story middles", () => {
  it("gives every new spoken gate two or more independent sources", () => {
    const advice = [greek, forest].flatMap(storyQuestWarnings).join("\n");
    for (const key of [
      "story-quest-greek-ajax-shield",
      "story-quest-forest-walkers",
      "story-quest-forest-hearth",
      "story-quest-forest-path",
      "story-quest-greek-burial",
    ])
      expect(advice).not.toContain(`${key} `);
    // Earlier single-speaker accounts stay visible as authoring advice.
    expect(advice).toContain(
      "story-quest-greek-ajax-plea gate greek-ajax-deliver-plea has one source",
    );
    expect(advice).toContain("story-quest-greek-table is a single card");
  });

  it("rejects a topics gate whose facts share one speaker", () => {
    const source = compiled.packs.find((p) => p.id === "greek-drama");
    const pack = structuredClone(source);
    const deliver = pack.choices.find(
      (c) => c.id === "greek-ajax-deliver-shield",
    );
    const gate = deliver.requires.find((c) => c.kind === "knows");
    expect(packProblems(pack, compiled.hub, mounted)).toEqual([]);
    pack.topics.find((t) => t.id === gate.topics[1]).speaker =
      "greek-ajax-teucer";
    pack.topics.find((t) => t.id === gate.topics[1]).at = "greek-greek-camp";
    pack.choices.find(
      (c) => c.id === "greek-ajax-learn-shield-odysseus",
    ).subject = "greek-ajax-teucer";
    expect(packProblems(pack, compiled.hub, mounted).join()).toMatch(
      /closed condition vocabulary/,
    );
  });
});

describe("the child's shield has a spoken middle", () => {
  it.each([
    ["Teucer", "greek-ajax-teucer", "greek-ajax-shield-teucer", false],
    ["Odysseus", "greek-ajax-odysseus", "greek-ajax-shield-odysseus", false],
    ["Tecmessa", "greek-ajax-tecmessa", "greek-ajax-shield-tecmessa", true],
  ])("learns where the shield belongs from %s", (_, speaker, fact, tent) => {
    let world = playOpenDoor(ajaxCamp(), "take", {
      item: "greek-ajax-shield",
    });
    world = ajaxMove(world, "greek-ajax-household");
    expect(offered(world, "greek-ajax-deliver-shield")).toBe(false);
    expect(questRecord(world, SHIELD).completedTurn).toBeNull();
    if (!tent) world = ajaxMove(world, "greek-greek-camp");
    world = ajaxTalk(world, fact, "vale", undefined, speaker);
    expect(knowsFact(world, "vale", fact)).toBe(true);
    expect(ajaxState(world).flags["greek-ajax-shield-keeper-heard"]).toBe(true);
    expect(
      ajaxState(world).receipts[fact.replace("shield-", "learn-shield-")],
    ).toBe(world.turn);
    world = reload(world);
    if (!tent) world = ajaxMove(world, "greek-ajax-household");
    world = ajaxChoice(world, "deliver-shield");
    expect(questRecord(world, SHIELD).completion).toMatchObject({
      actorId: "vale",
      participants: ["vale"],
    });
  });

  it("records one spoken step while each witness keeps their own account", () => {
    let world = ajaxTalk(ajaxCamp(), "greek-ajax-shield-teucer");
    world = ajaxTalk(
      world,
      "greek-ajax-shield-odysseus",
      "vale",
      undefined,
      "greek-ajax-odysseus",
    );
    expect(knowsFact(world, "vale", "greek-ajax-shield-odysseus")).toBe(true);
    expect(
      ajaxState(world).receipts["greek-ajax-learn-shield-odysseus"],
    ).toBeUndefined();
    expect(knowsFact(world, "mara", "greek-ajax-shield-teucer")).toBe(false);
  });

  it("keeps a saved delivery complete without the new spoken fact", () => {
    // A save from before this middle holds the ending receipt but no
    // learned fact or flag. The receipt alone still resolves the story.
    let world = playOpenDoor(ajaxCamp(), "take", {
      item: "greek-ajax-shield",
    });
    world = ajaxMove(world, "greek-ajax-household");
    // Play the delivery under the earlier rule, which had no spoken step.
    const deliver = greek.choices.find(
      (c) => c.id === "greek-ajax-deliver-shield",
    );
    const current = deliver.requires;
    deliver.requires = current.filter((c) => c.kind !== "knows");
    try {
      world = ajaxChoice(world, "deliver-shield");
    } finally {
      deliver.requires = current;
    }
    expect(syncStoryQuests(world)).toEqual([]);
    world = reload(world);
    expect(knowsFact(world, "vale", "greek-ajax-shield-teucer")).toBe(false);
    expect(
      ajaxState(world).flags["greek-ajax-shield-keeper-heard"],
    ).toBeUndefined();
    const definition = storyDefinitions(world).find((d) => d.key === SHIELD);
    expect(definition).toMatchObject({
      resolved: true,
      status: "fulfilled",
      choiceId: "greek-ajax-deliver-shield",
      completion: "Fulfilled",
    });
    expect(questRecord(world, SHIELD).completedTurn).toBe(
      ajaxState(world).receipts["greek-ajax-deliver-shield"],
    );
    // Teucer moves on to the plea; the shield's keeper is no longer news.
    world = ajaxMove(world, "greek-greek-camp");
    expect(
      ajaxTalk(world, "greek-ajax-plea").packs["greek-drama"].flags[
        "greek-ajax-plea-heard"
      ],
    ).toBe(true);
  });
});
