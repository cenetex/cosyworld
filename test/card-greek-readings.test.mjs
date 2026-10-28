import { beforeAll, describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  validateWorld,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { readingReplayAction } from "../v2/card-game/reading-actions.mjs";
import {
  readingReview,
  reviewReadingPage,
} from "../v2/card-game/reading-ui.mjs";
import { readingSpeechScope } from "../v2/card-game/reading-context.mjs";
import { privateView } from "../v2/card-game/learning.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { questCards, questHistoryCards } from "../v2/card-game/quest-cards.mjs";
import { validReadingDecisions } from "../v2/card-game/poem-readings.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { homecomingJourney } from "./helpers/greek-homecoming.mjs";
import { sharedReturnReading } from "./helpers/greek-return-reading.mjs";
import { houseGo } from "./helpers/greek-house-of-blood.mjs";
import {
  COURT,
  POETS,
  FROGS,
  courtJourney,
  readingPlay as act,
  finishReading,
  readHome,
} from "./helpers/greek-readings.mjs";

const PACK = "greek-drama",
  SITE = FROGS + "-court",
  ID = `site:${SITE}:vale`;
const state = (world) => world.packs[PACK].poemReadings;
let court;
beforeAll(() => {
  court = courtJourney();
});
describe("the actual poets' court", () => {
  it("starts with support evidence and earns the weighing only on the final page", () => {
    let world = act(court, "read", { readingOp: "start", siteId: SITE });
    const reading = state(world).readings[ID],
      before = structuredClone(reading);
    expect(reading.selection.length).toBeGreaterThan(4);
    expect(world.packs[PACK].receipts[FROGS + "-weigh"]).toBeUndefined();
    expect(world.items["greek-viii-verse-scales"].holder).toBe(COURT);
    while (!state(world).readings[ID].complete)
      world = act(world, "read", { readingOp: "page", readingId: ID });
    expect(world.packs[PACK].receipts[FROGS + "-weigh"]).toBe(world.turn);
    expect(state(world).readings[ID]).toMatchObject({
      turn: before.turn,
      through: before.through,
      selection: before.selection,
      poemDigest: before.poemDigest,
    });
    expect(state(world).decisions[FROGS + "-weigh"]).toBe(ID);
    const forged = structuredClone(world);
    delete state(forged).decisions[FROGS + "-weigh"];
    expect(validReadingDecisions(forged, packDefinition(PACK))).toBe(false);
    expect(() => validateWorld(forged)).toThrow();
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
  it.each(["aeschylus", "euripides", "living-chorus"])(
    "carries the %s voice and the bag home through actual plays",
    (voice) => {
      let world = finishReading(court, SITE);
      world = act(world, "take", { item: "greek-viii-reading-tablet" });
      world = act(world, "choose", { choiceId: FROGS + "-voice-" + voice });
      world = readHome(world, FROGS, "greek-viii-reading-tablet");
      expect(world.packs[PACK].choices["greek-viii-frogs-return-voice"]).toBe(
        voice,
      );
      expect(world.packs[PACK].choices["greek-atreid-account"]).toBeUndefined();
      expect(world.items["greek-viii-reading-tablet"].holder).toBe(
        "greek-courtyard",
      );
      expect(world.items["greek-viii-travel-bag"].holder).toBe("vale");
      expect(world.packs[PACK].receipts[FROGS + "-read-home"]).toBe(world.turn);
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
  );
  it("keeps the shared burden with Xanthias while the tablet returns", () => {
    const world = courtJourney("xanthias");
    expect(world.items["greek-viii-travel-bag"].holder).toBe(
      "greek-viii-xanthias",
    );
    expect(world.actors["greek-viii-xanthias"].place).toBe("greek-underworld");
    expect(world.packs[PACK].choices["greek-viii-frogs-burden"]).toBe(
      "xanthias",
    );
  });
  it("keeps heard pages with their audience after an outsider enters", () => {
    let world = structuredClone(court);
    world.sharedVersion = 1;
    world.controlledActors = ["vale", "mara", "ash"];
    world.presentActors = ["vale", "mara", "ash"];
    world.actors.mara.place = COURT;
    world = act(world, "read", {
      readingOp: "invite",
      invitee: "mara",
      siteId: SITE,
    });
    world = act(world, "read", { readingOp: "start", siteId: SITE });
    world = act(world, "read", { readingOp: "page", readingId: ID });
    const original = structuredClone(state(world).readings[ID]);
    let context = narrativeContext(world);
    const stanza = context.entities.find((e) => e.id === POETS[0]).poem
      .stanzas[0];
    expect(context.privateTo).toEqual(["vale", ...POETS, "mara"]);
    expect(
      context.entities.find((e) => e.id === POETS[0]).poem.stanzas,
    ).toHaveLength(4);
    expect(
      context.entities.find((e) => e.id === POETS[0]).poem.heard.reader,
    ).toBe("vale");
    const reply = {
      revision: world.revision,
      model: "fixture",
      entries: context.entities.map((e) => ({
        id: e.id,
        text: context.speakers.includes(e.id)
          ? stanza.lines.join(" ")
          : "The scales rest beside the tablet.",
      })),
    };
    world = applyGeneratedText(world, context, reply);
    expect(world.log.at(-1).privateTo).toEqual(context.privateTo);
    world.actors.ash.place = COURT;
    world = act(world, "talk", { target: POETS[0] });
    context = narrativeContext(world);
    const raw = JSON.stringify(context);
    expect(context.privateTo).toBeUndefined();
    expect(context.entities.find((e) => e.id === POETS[0]).poem).toBeNull();
    expect(raw).not.toContain(stanza.lines[0]);
    expect(raw).not.toContain(stanza.lines[1]);
    const outsider = privateView(world, "ash");
    expect(JSON.stringify(outsider)).not.toContain(stanza.lines[0]);
    expect(outsider.readingView.packs[PACK].readings).toEqual([]);
    expect(readingReview(outsider).packs[PACK].stanzas).toEqual([]);
    const bad = {
      revision: world.revision,
      model: "fixture",
      omitted: context.entities
        .filter((e) => e.id !== POETS[0])
        .map((e) => e.id),
      entries: [{ id: POETS[0], text: stanza.lines.join(" ") }],
    };
    expect(() => applyGeneratedText(world, context, bad)).toThrow();
    expect(() =>
      dispatchShared({
        op: "speech",
        world,
        actor: "vale",
        room: COURT,
        claimed: world.controlledActors,
        present: world.presentActors,
        lines: [{ actorId: "vale", text: stanza.lines.join(" ") }],
      }),
    ).toThrow();
    expect(state(world).readings[ID]).toEqual(original);
    expect(readingReplayAction(world, "vale", PACK, ID, 0, "ash")).toBeNull();
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
  it("reviews only heard pages and replays a missed page to an original guest", () => {
    let world = structuredClone(court);
    world.sharedVersion = 1;
    world.controlledActors = ["vale", "mara"];
    world.presentActors = ["vale", "mara"];
    world.actors.mara.place = COURT;
    world = act(world, "read", {
      readingOp: "invite",
      invitee: "mara",
      siteId: SITE,
    });
    world = act(world, "read", { readingOp: "start", siteId: SITE });
    world = act(world, "read", { readingOp: "page", readingId: ID });
    world.actors.mara.place = "greek-underworld";
    world = act(world, "read", { readingOp: "page", readingId: ID });
    world.actors.mara.place = COURT;
    while (!state(world).readings[ID].complete)
      world = act(world, "read", { readingOp: "page", readingId: ID });
    const heard = privateView(world, "mara").readingView.packs[PACK];
    expect(heard.readings[0].pages.map((p) => p[0])).toEqual([0]);
    expect(
      reviewReadingPage(
        PACK,
        heard,
        heard.readings[0],
        heard.readings[0].pages[0],
      ),
    ).toHaveLength(4);
    const original = structuredClone(state(world).readings[ID]);
    const replay = readingReplayAction(
      privateView(world, "vale"),
      "vale",
      PACK,
      ID,
      1,
      "mara",
    );
    world = act(world, "read", { key: replay.key });
    expect(state(world).readings[ID].turn).toBe(original.turn);
    expect(state(world).readings[ID].pages[1].slice(0, 2)).toEqual(
      original.pages[1].slice(0, 2),
    );
    expect(
      privateView(world, "mara").readingView.packs[PACK].readings[0].pages.map(
        (p) => p[0],
      ),
    ).toEqual([0, 1]);
    expect(validateWorld(world)).toBe(world);
  });
  it("keeps a guest's departure after real shared moves between two pages", () => {
    let world = structuredClone(court);
    world.sharedVersion = 1;
    world.controlledActors = ["vale", "mara"];
    world.presentActors = ["vale", "mara"];
    world.actors.mara.place = COURT;
    world = act(world, "read", {
      readingOp: "invite",
      invitee: "mara",
      siteId: SITE,
    });
    world = act(world, "read", { readingOp: "start", siteId: SITE });
    world = act(world, "read", { readingOp: "page", readingId: ID });
    world = act(world, "move", { target: "greek-underworld" }, "mara");
    world = act(world, "move", { target: COURT }, "mara");
    expect(state(world).readings[ID].departedMask & 8).toBe(8);
    world = act(world, "read", { readingOp: "page", readingId: ID });
    expect(
      privateView(world, "mara").readingView.packs[PACK].readings[0].pages.map(
        (p) => p[0],
      ),
    ).toEqual([0]);
    const replay = readingReplayAction(world, "vale", PACK, ID, 1, "mara");
    world = act(world, "read", { key: replay.key });
    expect(
      privateView(world, "mara").readingView.packs[PACK].readings[0].pages.map(
        (p) => p[0],
      ),
    ).toEqual([0, 1]);
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
  it("keeps a disconnect between page publications in the same bounded mask", () => {
    let world = structuredClone(court);
    world.sharedVersion = 1;
    world.controlledActors = ["vale", "mara"];
    world.presentActors = ["vale", "mara"];
    world.actors.mara.place = COURT;
    world = act(world, "read", {
      readingOp: "invite",
      invitee: "mara",
      siteId: SITE,
    });
    world = act(world, "read", { readingOp: "start", siteId: SITE });
    const reply = dispatchShared({
      op: "attendance",
      world,
      actor: "mara",
      claimed: ["vale", "mara"],
      present: ["vale"],
    });
    world = reply.world;
    world.playerActorId = "vale";
    world.controlledActors = ["vale", "mara"];
    world.presentActors = ["vale", "mara"];
    world = act(world, "read", { readingOp: "page", readingId: ID });
    expect(state(world).readings[ID].departedMask & 8).toBe(8);
    expect(privateView(world, "mara").readingView.packs[PACK].readings).toEqual(
      [],
    );
    expect(validateWorld(world)).toBe(world);
  });
});

it("reaches Prometheus from the released opening and returns the carried record", () => {
  let world = homecomingJourney().world;
  world = act(world, "choose", { choiceId: "greek-vii-open-accounts" });
  world = act(world, "take", { item: "lamp" });
  world = houseGo(world, "greek-vii-crag-camp");
  expect(entityActive(world, "greek-ajax-teucer")).toBe(false);
  expect(entityActive(world, "greek-susa-atossa")).toBe(false);
  world = act(world, "light", { item: "lamp" });
  world = houseGo(world, "greek-scythian-crag");
  world = act(world, "choose", {
    choiceId: "greek-vii-prometheus-flame-arrived",
  });
  world = act(world, "snuff", { item: "lamp" });
  for (const item of ["greek-vii-io-message", "greek-vii-storm-record"])
    world = act(world, "take", { item });
  world = houseGo(world, "greek-susa");
  world = act(world, "give", {
    item: "greek-vii-io-message",
    target: "greek-vii-io",
  });
  world = act(world, "choose", {
    choiceId: "greek-vii-prometheus-io-message-arrived",
  });
  world = houseGo(world, "greek-scythian-crag");
  world = act(world, "choose", { choiceId: "greek-vii-prometheus-stay" });
  world = readHome(world, "greek-vii-prometheus", "greek-vii-storm-record");
  expect(world.packs[PACK].receipts["greek-vii-prometheus-read-home"]).toBe(
    world.turn,
  );
  expect(world.items["greek-vii-io-message"].holder).toBe("greek-vii-io");
  expect(world.items.lamp.lit).toBe(false);
  expect(decodeSave(encodeSave(world))).toEqual(world);
});

it("keeps the pending Frogs task with a second reader at the poets' court", () => {
  let world = dispatchShared({ op: "create", save: encodeSave(court) }).world;
  world.actors.mara.place = COURT;
  world.actors.ash.place = COURT;
  const key = `${PACK}:${FROGS}`;
  const request = (op, actor, fields = {}) => {
    const result = dispatchShared({
      op,
      actor,
      world,
      claimed: ["vale", "mara", "ash"],
      present: ["vale", "mara", "ash"],
      ...fields,
    });
    expect(result.ok, result.error).toBe(true);
    if (op !== "view") world = result.world;
    return result;
  };
  const sharedAct = (actor, kind, fields = {}) => {
    const action = request("view", actor).actions.find(
      (candidate) =>
        candidate.kind === kind &&
        Object.entries(fields).every(([k, v]) => candidate[k] === v),
    );
    expect(action, `${actor} ${kind} ${JSON.stringify(fields)}`).toBeDefined();
    return request("play", actor, { action });
  };
  const pending = () => {
    expect(world.quests.records[key].completedTurn).toBeNull();
    expect(world.quests.records[key].participants).toContain("mara");
    expect(questHistoryCards(world, "mara").some((q) => q.key === key)).toBe(
      true,
    );
    expect(questCards(world, "mara").some((q) => q.key === key)).toBe(true);
  };
  for (const action of request("view", "mara").actions.filter(
    (a) => a.kind === "drop-quest",
  ))
    request("play", "mara", { action });
  sharedAct("vale", "give", {
    item: "greek-viii-verse-scales",
    target: "mara",
  });
  expect(questHistoryCards(world, "mara").some((q) => q.key === key)).toBe(
    false,
  );
  sharedAct("mara", "read", { readingOp: "start", siteId: SITE });
  pending();
  const id = `site:${SITE}:mara`;
  expect(state(world).readings[id].selection.length).toBeGreaterThan(4);
  sharedAct("mara", "read", { readingOp: "page", readingId: id });
  pending();
  const loaded = decodeSave(encodeSave(world));
  expect(loaded).toEqual(world);
  world = loaded;
  pending();
  while (!state(world).readings[id].complete)
    sharedAct("mara", "read", { readingOp: "page", readingId: id });
  expect(world.packs[PACK].recitals[FROGS + "-weigh"].actor).toBe("mara");
  expect(world.packs[PACK].recitals[FROGS + "-carry-burden"].actor).toBe(
    "vale",
  );
  pending();
  const participants = [...world.quests.records[key].participants];
  sharedAct("ash", "read", { readingOp: "start", siteId: SITE });
  expect(world.quests.records[key].participants).toEqual(participants);
  expect(questHistoryCards(world, "ash").some((q) => q.key === key)).toBe(
    false,
  );
  expect(decodeSave(encodeSave(world))).toEqual(world);
}, 60000);

it("keeps the second carrier's task through signed Talk and the whole reading", () => {
  let world = finishReading(court, SITE);
  world = act(world, "take", { item: "greek-viii-reading-tablet" });
  world = act(world, "choose", { choiceId: FROGS + "-voice-euripides" });
  sharedReturnReading(world, {
    prefix: FROGS,
    item: "greek-viii-reading-tablet",
    topicId: FROGS + "-account-euripides",
    storyId: FROGS,
    checkArchive: true,
  });
}, 60000);

it("uses active listeners for the shared-page intersection", () => {
  let world = act(court, "read", { readingOp: "start", siteId: SITE });
  world = act(world, "read", { readingOp: "page", readingId: ID });
  const audience = ["vale", ...POETS, "greek-susa-atossa"];
  expect(entityActive(world, "greek-susa-atossa")).toBe(false);
  expect(readingSpeechScope(world, null, audience).privateTo).toEqual([
    "vale",
    ...POETS,
  ]);
  expect(readingSpeechScope(world, null, [...audience, "moth"])).toEqual({});
});

it("keeps fresh reading archives inside the shared save", () => {
  const world = createWorld();
  expect(state(world)).toMatchObject({
    version: 1,
    readings: {},
    decisions: {},
  });
  expect(legalActions(world).every((a) => a.kind !== "read")).toBe(true);
});
