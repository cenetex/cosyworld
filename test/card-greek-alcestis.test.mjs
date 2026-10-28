import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  addLog,
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  people,
  play,
  publishKnowledgeSpeech,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { knowledgeDisclosures, knowsFact } from "../v2/card-game/knowledge.mjs";
import {
  expressionKind,
  validExpression,
} from "../v2/card-game/expression.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

const PACK = "greek-drama";
const F = "greek-alcestis-";
const PHERAE = "greek-pherae";
const COURTYARD = "greek-courtyard";
const CHLORIS = `${F}chloris`;
const HERACLES = `${F}heracles`;
const ALCESTIS = `${F}alcestis`;
const rows = [
  ["truth", "children"],
  ["truth", "shared"],
  ["conceal", "children"],
  ["conceal", "shared"],
];

function chapterStart(shared = false) {
  // This chapter fixture starts after the earlier journey to Dione.
  const world = createWorld({ opening: true });
  delete world.opening;
  world.actors.vale.place = COURTYARD;
  world.actors.moth.place = "station";
  world.items.lamp.holder = "pond";
  world.packs[PACK].met["greek-baker"] = 0;
  if (shared) {
    world.sharedVersion = 1;
    world.playerActorId = "vale";
    world.controlledActors = ["vale", "mara"];
    world.presentActors = ["vale", "mara"];
    world.actors.mara.place = COURTYARD;
  }
  return decodeSave(encodeSave(world));
}

function findAction(world, kind, fields = {}, actor = "vale") {
  return legalActions(world, actor).find(
    (action) =>
      action.kind === kind &&
      Object.entries(fields).every(([key, value]) => action[key] === value),
  );
}

function act(world, kind, fields = {}, actor = "vale") {
  const action = findAction(world, kind, fields, actor);
  assert(action, `${actor} ${kind} ${JSON.stringify(fields)}`);
  const result = play(world, action, world.revision, actor);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(
    play(decodeSave(encodeSave(world)), action, world.revision, actor),
    result,
  );
  return decodeSave(encodeSave(result.state));
}

const choose = (world, id, actor) =>
  act(world, "choose", { choiceId: F + id }, actor);
const take = (world, id, actor) => act(world, "take", { item: F + id }, actor);

function openChair(world) {
  assert.equal(entityActive(world, ALCESTIS), false);
  assert.equal(entityActive(world, HERACLES), false);
  assert.equal(exits(world, COURTYARD, "vale").includes(PHERAE), false);
  world = choose(world, "invitation");
  assert(exits(world, COURTYARD, "vale").includes(PHERAE));
  world = act(world, "move", { target: PHERAE });
  assert(exits(world, PHERAE, "vale").includes(COURTYARD));
  for (const id of ["hear-bargain", "hear-wishes", "hear-death"])
    world = choose(world, id);
  world = take(world, "loaf");
  world = choose(world, "prepare-loaf");
  return take(world, "cup");
}

function returnAlcestis(world, welcome) {
  world = choose(world, "receive-guest");
  assert(entityActive(world, HERACLES));
  world = take(world, "wine-jug");
  world = choose(world, welcome === "truth" ? "tell-guest" : "serve-guest");
  assert.equal(world.items[F + "wine-jug"].holder, PHERAE);
  assert.equal(world.packs[PACK].choices[F + "welcome"], welcome);
  assert.equal(
    findAction(world, "choose", {
      choiceId: F + (welcome === "truth" ? "serve-guest" : "tell-guest"),
    }),
    undefined,
  );
  // The source servant discloses the death in both welcome branches.
  for (const id of [
    "hear-parents",
    "hear-servant",
    "hear-resolve",
    "witness-return",
  ])
    world = choose(world, id);
  assert.equal(world.packs[PACK].flags[F + "guest-informed"], true);
  assert(entityActive(world, ALCESTIS));
  assert.equal(world.actors[ALCESTIS].place, PHERAE);
  assert.equal(expressionKind(people[ALCESTIS]), "narration");
  assert(
    validExpression(people[ALCESTIS], "Alcestis of Pherae lowers her eyes."),
  );
  assert.equal(
    validExpression(people[ALCESTIS], "Alcestis of Pherae says I agree."),
    false,
  );
  const saved = decodeSave(encodeSave(world));
  assert(entityActive(saved, ALCESTIS));
  assert.deepEqual(saved.packs[PACK].met, world.packs[PACK].met);
  return saved;
}

function hearCare(world, care) {
  const topic = F + "promise-" + care;
  assert.equal(knowsFact(world, "vale", topic), false);
  world = act(world, "talk", { target: CHLORIS });
  const disclosures = knowledgeDisclosures(
    world,
    [CHLORIS],
    [CHLORIS, "vale"],
    PHERAE,
  );
  assert.equal(disclosures[0]?.factId, topic);
  const publish = (before) => {
    const next = structuredClone(before);
    addLog(next, people[CHLORIS].name, disclosures[0].text, {
      generated: true,
      kind: "dialogue",
      actorId: CHLORIS,
      locationId: PHERAE,
      cast: [CHLORIS, "vale"],
    });
    publishKnowledgeSpeech(next, next.log.at(-1), disclosures);
    return next;
  };
  const result = publish(world);
  assert.deepEqual(publish(decodeSave(encodeSave(world))), result);
  assert(knowsFact(result, "vale", topic));
  assert.equal(result.knowledge.known.vale[topic].teller, CHLORIS);
  return decodeSave(encodeSave(result));
}

describe("Alcestis at Pherae", () => {
  it.each(rows)(
    "keeps the %s welcome and %s pledge through saved play",
    (welcome, care) => {
      let world = chapterStart();
      const oldFood = Object.fromEntries(
        ["greek-grove-cup", "greek-bread"]
          .filter((id) => world.items[id])
          .map((id) => [id, structuredClone(world.items[id])]),
      );
      world = openChair(world);
      world = choose(world, "set-cup");
      assert.equal(world.items[F + "cup"].holder, PHERAE);
      assert.equal(world.items[F + "loaf"].holder, PHERAE);
      world = returnAlcestis(world, welcome);
      world = take(world, "care-tablet");
      world = choose(world, "pledge-" + care);
      assert.equal(world.items[F + "care-tablet"].holder, PHERAE);
      assert.equal(world.packs[PACK].choices[F + "care"], care);
      assert.equal(
        findAction(world, "choose", {
          choiceId:
            F + "pledge-" + (care === "children" ? "shared" : "children"),
        }),
        undefined,
      );
      const unheardReturn = act(world, "move", { target: COURTYARD });
      assert.equal(
        findAction(unheardReturn, "choose", { choiceId: F + "report-" + care }),
        undefined,
      );
      world = act(unheardReturn, "move", { target: PHERAE });
      world = hearCare(world, care);
      world = act(world, "move", { target: COURTYARD });
      world = choose(world, "report-" + care);
      assert.equal(world.items[F + "care-tablet"].holder, PHERAE);
      assert.equal(world.actors[ALCESTIS].place, PHERAE);
      for (const [id, before] of Object.entries(oldFood))
        assert.deepEqual(world.items[id], before);
      const poem = recitalPoem(world, packDefinition(PACK));
      const stanzas = poem.stanzas.filter((stanza) => stanza.id.startsWith(F));
      assert.equal(stanzas.length, 5);
      assert(
        stanzas.some(
          (stanza) =>
            stanza.id ===
            F + (welcome === "truth" ? "tell-guest" : "serve-guest"),
        ),
      );
      assert.equal(
        stanzas.some(
          (stanza) =>
            stanza.id ===
            F + (welcome === "truth" ? "serve-guest" : "tell-guest"),
        ),
        false,
      );
      assert.deepEqual(
        recitalPoem(decodeSave(encodeSave(world)), packDefinition(PACK)),
        poem,
      );
    },
  );

  it("keeps the deed with the human who places the cup", () => {
    let world = openChair(chapterStart(true));
    world = act(world, "move", { target: PHERAE }, "mara");
    assert.equal(
      findAction(world, "choose", { choiceId: F + "set-cup" }, "mara"),
      undefined,
    );
    world = act(world, "give", { item: F + "cup", target: "mara" });
    world = choose(world, "set-cup", "mara");
    assert.equal(world.items[F + "cup"].holder, PHERAE);
    assert.equal(world.packs[PACK].recitals[F + "set-cup"].actor, "mara");
    assert.equal(world.packs[PACK].recitals[F + "set-cup"].visit, null);
  });

  it("publishes a shared pledge after the saved disclosure and records the return", () => {
    let world = chapterStart(true);
    const request = (op, extra = {}, actor = "vale", before = world) =>
      dispatchShared({
        op,
        world: before,
        actor,
        claimed: ["vale", "mara"],
        present: ["vale", "mara"],
        ...extra,
      });
    const sharedAct = (kind, fields = {}, actor = "vale") => {
      const action = request("view", {}, actor).actions.find(
        (a) =>
          a.kind === kind &&
          Object.entries(fields).every(([key, value]) => a[key] === value),
      );
      assert(action, `${actor} ${kind} ${JSON.stringify(fields)}`);
      const result = request(
        "play",
        { action, revision: world.revision },
        actor,
      );
      assert.equal(result.ok, true, result.error);
      assert.deepEqual(
        request(
          "play",
          { action, revision: world.revision },
          actor,
          decodeSave(encodeSave(world)),
        ),
        result,
      );
      world = result.world;
      return result;
    };
    const sharedChoice = (id, actor) =>
      sharedAct("choose", { choiceId: F + id }, actor);
    sharedChoice("invitation");
    sharedAct("move", { target: PHERAE });
    sharedAct("move", { target: PHERAE }, "mara");
    for (const id of ["hear-bargain", "hear-wishes", "hear-death"])
      sharedChoice(id);
    sharedAct("take", { item: F + "loaf" });
    sharedChoice("prepare-loaf");
    sharedAct("take", { item: F + "cup" });
    sharedAct("give", { item: F + "cup", target: "mara" });
    sharedChoice("set-cup", "mara");
    sharedChoice("receive-guest");
    sharedAct("take", { item: F + "wine-jug" });
    sharedChoice("serve-guest");
    for (const id of [
      "hear-parents",
      "hear-servant",
      "hear-resolve",
      "witness-return",
    ])
      sharedChoice(id);
    sharedAct("take", { item: F + "care-tablet" });
    sharedChoice("pledge-shared");
    const topic = F + "promise-shared";
    assert.equal(knowsFact(world, "vale", topic), false);
    const talk = sharedAct("talk", { target: CHLORIS });
    const disclosures = talk.context.disclosures;
    assert.equal(disclosures[0]?.factId, topic);
    const speech = {
      room: PHERAE,
      disclosures,
      lines: [
        { actorId: "vale", text: "Please tell me who will share the work." },
        { actorId: CHLORIS, text: disclosures[0].text },
      ],
    };
    const spoken = request("speech", speech);
    assert.equal(spoken.ok, true, spoken.error);
    assert.deepEqual(
      request("speech", speech, "vale", decodeSave(encodeSave(world))),
      spoken,
    );
    world = spoken.world;
    assert(knowsFact(world, "vale", topic));
    assert.equal(world.knowledge.known.vale[topic].teller, CHLORIS);
    sharedAct("move", { target: COURTYARD });
    sharedChoice("report-shared");
    assert.equal(world.packs[PACK].recitals[F + "set-cup"].actor, "mara");
    assert.equal(world.items[F + "care-tablet"].holder, PHERAE);
    assert.equal(world.actors[ALCESTIS].place, PHERAE);
    assert.deepEqual(request("validate").world, world);
    assert.equal(
      recitalPoem(world, packDefinition(PACK)).stanzas.filter((stanza) =>
        stanza.id.startsWith(F),
      ).length,
      5,
    );
  });
});
