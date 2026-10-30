import { afterEach, describe, expect, it } from "vitest";
import { openingFixture } from "./helpers/greek-opening.mjs";
import { currentPlaces } from "./helpers/card-place-graph.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  things,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import {
  installHumanLife,
  lifeOf,
  personalQuestRank,
  purposeOrigin,
  settleLife,
  sparkOf,
  LIFE_VERSION,
} from "../v2/card-game/life.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { actorQuests, generateProgram } from "../v2/card-game/quests.mjs";
import { packPeople } from "../v2/card-game/pack-registry.mjs";
import { storyDefinitions } from "../v2/card-game/story-quests.mjs";
import {
  openStoryNeeds,
  storyLean,
  STORY_LEAN,
} from "../v2/card-game/story-life.mjs";

const BURIAL = "greek-drama:story-quest-greek-burial";
const TABLE = "greek-drama:story-quest-greek-table";
const reload = (world) => decodeSave(encodeSave(world));
function act(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  // A saved copy replays the same play to the same state.
  expect(play(reload(world), action)).toEqual(result);
  return result.state;
}
// Vale rests after an earlier quest; the last rest round is ahead.
function resting(world) {
  const s = structuredClone(world);
  const life = lifeOf(s, "vale");
  life.phase = "content";
  life.quiet = 0;
  life.restLeft = 1;
  life.finished = s.turn - 1;
  delete life.restAt;
  delete life.origin;
  return s;
}
const opening = openingFixture("refusal");

describe("story endings reach lives", () => {
  it("lets a refusal and a fulfilled story seed different next purposes", () => {
    const declined = act(opening.decree, "choose", {
      choiceId: "greek-decline-burial",
    });
    expect(lifeOf(declined, "vale").experiences.at(-1)).toEqual({
      kind: "story",
      turn: declined.turn,
      other: "greek-antigone",
      item: null,
      place: "greek-gate",
      story: BURIAL,
      outcome: "declined",
    });
    const fulfilled = act(opening.waterOffer, "choose", {
      choiceId: "greek-return-water-jar",
    });
    expect(lifeOf(fulfilled, "vale").experiences.at(-1)).toMatchObject({
      story: TABLE,
      outcome: "fulfilled",
      place: "greek-courtyard",
    });
    // The rest ends and the ending becomes the new purpose's origin.
    const after = (world) => {
      const s = resting(world);
      expect(settleLife(s, ["vale"])).toEqual(["vale"]);
      return s;
    };
    const refusal = after(declined),
      kept = after(fulfilled);
    expect(lifeOf(refusal, "vale").origin).toMatchObject({
      story: BURIAL,
      outcome: "declined",
    });
    expect(lifeOf(kept, "vale").origin).toMatchObject({
      story: TABLE,
      outcome: "fulfilled",
    });
    expect(purposeOrigin(refusal, "vale")).toMatch(/^the refusal at /);
    expect(purposeOrigin(kept, "vale")).toMatch(
      /^the story that came true at /,
    );
    // The outcome chooses the kind of purpose it favours.
    const shaped = (world, situation) =>
      personalQuestRank(world, "vale", { generated: { situation } }) -
      personalQuestRank(world, "vale", { generated: { situation: "bargain" } });
    expect(shaped(refusal, "answer")).toBe(-8);
    expect(shaped(refusal, "gathering")).toBe(0);
    expect(shaped(kept, "gathering")).toBe(-8);
    expect(shaped(kept, "answer")).toBe(0);
  });

  it("carries the ending home to rest in real play", () => {
    const next = act(resting(opening.decree), "choose", {
      choiceId: "greek-decline-burial",
    });
    // The gate is no sanctuary, so Vale heads home thinking of the refusal.
    expect(lifeOf(next, "vale").phase).toBe("returning");
    const spark = structuredClone(next);
    lifeOf(spark, "vale").phase = "seeking";
    expect(sparkOf(spark, "vale")).toMatchObject({
      story: BURIAL,
      outcome: "declined",
    });
  });

  it("keeps a story memory for the next rest while a quest is active", () => {
    const s = structuredClone(opening.decree);
    const before = lifeOf(s, "vale").phase;
    const next = act(s, "choose", { choiceId: "greek-decline-burial" });
    const life = lifeOf(next, "vale");
    expect(life.phase).toBe(before);
    expect(life.experiences.at(-1)).toMatchObject({
      kind: "story",
      outcome: "declined",
    });
    // Once the current quest ends, the ending outweighs everyday talk.
    life.phase = "seeking";
    life.finished = next.turn - 1;
    delete life.restAt;
    expect(sparkOf(next, "vale")).toMatchObject({ kind: "story" });
  });

  it("records the ending once and replays it the same way", () => {
    const first = act(opening.decree, "choose", {
      choiceId: "greek-decline-burial",
    });
    const again = act(structuredClone(opening.decree), "choose", {
      choiceId: "greek-decline-burial",
    });
    expect(again).toEqual(first);
    const later = act(first, "wait");
    const stories = (w) =>
      lifeOf(w, "vale").experiences.filter((e) => e.story === BURIAL);
    expect(stories(later)).toEqual(stories(first));
    expect(stories(later)).toHaveLength(1);
  });
});

describe("story endings become news", () => {
  it("lets those present witness the ending and retell it through Talk", () => {
    const declined = act(opening.decree, "choose", {
      choiceId: "greek-decline-burial",
    });
    const fact = declined.knowledge.facts[`ending:${BURIAL}`];
    expect(fact.text).toBe(
      'At Theban City Gate, Vale turned down "Her brother waits for earth".',
    );
    expect(fact.source).toMatchObject({
      kind: "ending",
      actorId: "vale",
      locationId: "greek-gate",
    });
    for (const id of fact.source.witnesses)
      expect(declined.actors[id].place).toBe("greek-gate");
    expect(fact.source.witnesses).toEqual(
      expect.arrayContaining(["vale", "greek-antigone"]),
    );
    expect(knowsFact(declined, "greek-baker", fact.id)).toBe(false);

    // The baker was away at the courtyard. Vale carries the news there.
    let world = structuredClone(opening.returning);
    expect(knowsFact(world, "greek-baker", fact.id)).toBe(false);
    const talk = legalActions(world).find(
      (a) => a.kind === "talk" && a.target === "greek-baker",
    );
    world = play(world, talk).state;
    const context = narrativeContext(world, talk);
    expect(context.disclosures).toEqual([
      expect.objectContaining({
        factId: fact.id,
        speaker: "vale",
        listener: "greek-baker",
        text: fact.text,
      }),
    ]);
    world = applyGeneratedText(world, context, {
      revision: context.revision,
      model: "fixture",
      entries: context.entities.map(({ id }) => ({
        id,
        text: id === "vale" ? fact.text : "I am glad to see you.",
      })),
    });
    expect(world.knowledge.known["greek-baker"][fact.id]).toMatchObject({
      kind: "heard",
      teller: "vale",
    });
    expect(reload(world)).toEqual(world);
  });

  it("rejects a damaged ending fact", () => {
    const declined = act(opening.decree, "choose", {
      choiceId: "greek-decline-burial",
    });
    const broken = structuredClone(declined);
    broken.knowledge.facts[`ending:${BURIAL}`].source.topic = {
      packId: "greek-drama",
      id: "x",
      choiceId: null,
    };
    expect(() => validateWorld(broken)).toThrow();
    const story = structuredClone(declined);
    lifeOf(story, "vale").experiences.at(-1).outcome = "won";
    expect(() => validateWorld(story)).toThrow();
  });
});

describe("hopes lean on open stories", () => {
  afterEach(() => {
    delete packPeople.rati.personalQuests;
  });
  function cottage() {
    let w = enableMotives(createWorld(), {
      questPrograms: true,
      personalQuests: true,
    });
    w.actors.vale.place = "attic";
    w.items.cloth.holder = "vale";
    w.items.lamp.holder = "station";
    w.items.lamp.lit = false;
    w.items.lamp.fuel = 0;
    w = act(w, "move", { target: "forest-cottage" });
    w = act(w, "talk", { target: "rati" });
    w = act(w, "choose", { choiceId: "forest-stay-for-tea" });
    // Clear the path and mark the watch, so the homecoming story opens.
    w = act(w, "move", { target: "forest-garden" });
    w = act(w, "choose", { choiceId: "forest-clear-drain" });
    w = act(w, "move", { target: "forest-trail" });
    w = act(w, "choose", { choiceId: "forest-mark-pawprints" });
    w = act(w, "move", { target: "forest-garden" });
    w = act(w, "move", { target: "forest-cottage" });
    // A pack that opts its host into personal quests in a shared world.
    packPeople.rati.personalQuests = true;
    installHumanLife(w, (id) =>
      id === "rati" ? { quests: true, home: "forest-cottage" } : null,
    );
    w.sharedVersion = 1;
    return w;
  }

  it("prefers bringing a need to the open story's place without finishing it", () => {
    const w = cottage();
    const needs = openStoryNeeds(w, "rati");
    expect(needs).toEqual([
      {
        key: "lonely-forest:story-quest-forest-homecoming",
        holder: { kind: "avatar", id: "skull" },
        places: ["forest-cottage"],
        items: ["forest-wolfprint-charm"],
      },
    ]);
    const before = structuredClone(w);
    const program = generateProgram(
      structuredClone(w),
      "rati",
      currentPlaces(w),
      things,
    );
    expect(storyLean(w, "rati", program)).toBe(STORY_LEAN);
    // Same saved state, same purpose.
    expect(
      generateProgram(structuredClone(w), "rati", currentPlaces(w), things),
    ).toEqual(program);
    // Generation leaves the story and the world untouched.
    expect(w).toEqual(before);
    expect(
      storyDefinitions(w).find((d) => d.key === needs[0].key).resolved,
    ).toBe(false);
  });

  it("ignores stories for residents without personal quests or once resolved", () => {
    const w = cottage();
    delete packPeople.rati.personalQuests;
    expect(openStoryNeeds(w, "rati")).toEqual([]);
    packPeople.rati.personalQuests = true;
    expect(openStoryNeeds(w, "vale")).toEqual([]);
    const done = structuredClone(w);
    done.packs["lonely-forest"].receipts["forest-leave-charm"] = done.turn;
    expect(openStoryNeeds(done, "rati")).toEqual([]);
    expect(
      storyLean(done, "rati", {
        steps: [{ items: [], location: "forest-cottage", avatars: ["vale"] }],
      }),
    ).toBe(0);
  });
});

describe("earlier life saves", () => {
  // A save written before story experiences: the same world without them.
  function earlier(world) {
    const json = JSON.parse(encodeSave(world));
    for (const life of Object.values(json.life.actors)) {
      life.experiences = life.experiences.filter((e) => e.kind !== "story");
      if (life.origin?.kind === "story") delete life.origin;
    }
    for (const id of Object.keys(json.knowledge.facts))
      if (id.startsWith("ending:")) {
        delete json.knowledge.facts[id];
        for (const known of Object.values(json.knowledge.known))
          delete known[id];
      }
    json.knowledge.pending = json.knowledge.pending.filter(
      (p) => !p.factId.startsWith("ending:"),
    );
    return json;
  }

  it("loads a version 2 save without changing its quests, items, memories or levels", () => {
    const json = earlier(opening.decree);
    expect(json.life.version).toBe(2);
    expect(LIFE_VERSION).toBe(2);
    const loaded = decodeSave(JSON.stringify(json));
    expect(JSON.parse(encodeSave(loaded))).toEqual(json);
    for (const id of Object.keys(json.actors)) {
      expect(loaded.actors[id].progress).toEqual(json.actors[id].progress);
      expect(
        actorQuests(loaded, id).map((q) => [q.key, q.status, q.step]),
      ).toEqual(
        actorQuests(opening.decree, id).map((q) => [q.key, q.status, q.step]),
      );
    }
    expect(loaded.items).toEqual(json.items);
    expect(loaded.memories).toEqual(json.memories);
    // The loaded save then records its next story ending as usual.
    const next = act(loaded, "choose", { choiceId: "greek-decline-burial" });
    expect(lifeOf(next, "vale").experiences.at(-1)).toMatchObject({
      story: BURIAL,
      outcome: "declined",
    });
    expect(next.knowledge.facts[`ending:${BURIAL}`]).toBeTruthy();
  });
});
