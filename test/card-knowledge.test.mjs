import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newKnowledge,
  installKnowledge,
  witnessKnowledge,
  reserveKnowledge,
  knowledgeDisclosures,
  acceptKnowledgeSpeech,
  knowsFact,
  factDelivered,
  factWords,
  validKnowledge,
  validFactText,
  KNOWLEDGE_FACT_LIMIT,
  knowledgeFacts,
  ageText,
} from "../v2/card-game/knowledge.mjs";
import {
  addLog,
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  publishKnowledgeSpeech,
} from "../v2/card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { sharedContext } from "../v2/card-game/shared-narrator.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { openDoorStart, openDoorWalk } from "./helpers/open-door.mjs";

const clause = "Pip found a shell beside the pond.";
const bare = () => ({
  turn: 0,
  eventSeq: 1,
  actors: {
    vale: { place: "station" },
    moth: { place: "station" },
    keeper: { place: "station" },
  },
  knowledge: newKnowledge(),
});
const source = (w, extra = {}) => {
  const entry = {
    seq: ++w.eventSeq,
    turn: w.turn,
    kind: "action",
    verb: "give",
    actorId: "moth",
    locationId: "station",
    cast: ["moth"],
    witnesses: ["moth"],
    text: clause,
    ...extra,
  };
  return witnessKnowledge(w, entry);
};
const talk = (w, speaker = "moth", listener = "vale", topics = []) => {
  const entry = { seq: ++w.eventSeq, turn: w.turn };
  reserveKnowledge(w, speaker, listener, entry, topics);
  return knowledgeDisclosures(
    w,
    [speaker],
    [speaker, listener],
    w.actors[speaker].place,
    entry.seq,
  );
};
const speech = (w, ds, words = ds[0]?.text, extra = {}) =>
  acceptKnowledgeSpeech(
    w,
    {
      seq: ++w.eventSeq,
      turn: w.turn,
      generated: true,
      kind: "dialogue",
      actorId: ds[0]?.speaker,
      locationId: w.actors[ds[0]?.speaker]?.place,
      cast: [ds[0]?.speaker, ds[0]?.listener],
      text: words,
      ...extra,
    },
    ds,
  );
const worldWithNews = () => {
  const w = createWorld();
  for (const id of ["vale", "moth", "keeper"]) w.actors[id].place = "station";
  addLog(w, "World", clause, {
    kind: "action",
    verb: "give",
    actorId: "moth",
    locationId: "station",
    cast: ["moth"],
    witnesses: ["moth"],
  });
  return w;
};
const localTalk = (w) => {
  const a = legalActions(w).find(
    (a) => a.kind === "talk" && a.target === "moth",
  );
  const result = play(w, a);
  expect(result.ok).toBe(true);
  return { world: result.state, context: narrativeContext(result.state, a) };
};
const response = (context, words) => ({
  revision: context.revision,
  model: "fixture",
  entries: context.entities.map(({ id }) => ({
    id,
    text:
      id === context.disclosures[0].speaker ? words : "I am glad to see you.",
  })),
});

describe("saved public knowledge", () => {
  it("records source witnesses and teaches an absent listener through confirmed speech", () => {
    const w = bare();
    const fact = source(w);
    expect(knowsFact(w, "moth", fact.id)).toBe(true);
    expect(knowsFact(w, "vale", fact.id)).toBe(false);
    w.turn = 1;
    const ds = talk(w);
    expect(knowsFact(w, "vale", fact.id)).toBe(false);
    expect(speech(w, ds)).toHaveLength(1);
    expect(w.knowledge.known.vale[fact.id]).toMatchObject({
      kind: "heard",
      teller: "moth",
      learnedTurn: 1,
    });
    expect(w.knowledge.facts[fact.id].source).toMatchObject({
      actorId: "moth",
      eventSeq: 2,
      witnesses: ["moth"],
    });
    expect(talk(w)).toEqual([]);
    expect(validKnowledge(w, Object.keys(w.actors), ["station"])).toBe(true);
  });

  it("keeps the same pending disclosure through an irrelevant or negated reply", () => {
    const w = bare(),
      fact = source(w);
    w.turn = 1;
    const ds = talk(w);
    for (const words of [
      "The wind feels warm.",
      "It is false that Pip found a shell beside the pond.",
      "Pip found a shell beside the pond",
    ])
      expect(speech(w, ds, words)).toEqual([]);
    expect(knowsFact(w, "vale", fact.id)).toBe(false);
    expect(
      knowledgeDisclosures(w, ["moth"], ["moth", "vale"], "station"),
    ).toEqual(ds);
    expect(
      speech(
        w,
        ds,
        `“${clause.toUpperCase()}” I thought you would like to hear.`,
      ),
    ).toHaveLength(1);
    expect(speech(w, ds)).toEqual([]);
  });

  it("uses one hop per round and keeps the immediate teller on each hop", () => {
    const w = bare(),
      fact = source(w);
    w.turn = 1;
    speech(w, talk(w));
    expect(talk(w, "vale", "keeper")).toEqual([]);
    w.turn = 2;
    speech(w, talk(w, "vale", "keeper"));
    expect(w.knowledge.known.keeper[fact.id]).toMatchObject({
      kind: "heard",
      teller: "vale",
      learnedTurn: 2,
    });
    expect(w.knowledge.facts[fact.id].source.actorId).toBe("moth");
  });

  it("binds publication to the original Talk and its actual room audience", () => {
    const w = bare(),
      fact = source(w);
    w.turn = 1;
    const ds = talk(w);
    expect(speech(w, [{ ...ds[0], eventSeq: ds[0].eventSeq + 1 }])).toEqual([]);
    expect(speech(w, ds, clause, { cast: ["moth"] })).toEqual([]);
    w.actors.moth.place = w.actors.vale.place = "pond";
    w.turn = 2;
    const next = talk(w);
    expect(next[0].eventSeq).not.toBe(ds[0].eventSeq);
    expect(speech(w, ds)).toEqual([]);
    expect(speech(w, next)).toHaveLength(1);
    expect(knowsFact(w, "vale", fact.id)).toBe(true);
  });

  it("keeps only complete short rule facts and skips generated speech and private thoughts", () => {
    const w = bare();
    expect(source(w, { generated: true })).toBeNull();
    expect(source(w, { kind: "narration" })).toBeNull();
    expect(source(w, { text: "A sentence. A second sentence." })).toBeNull();
    expect(source(w, { text: `${"long ".repeat(40)}news.` })).toBeNull();
    expect(Object.keys(w.knowledge.facts)).toEqual([]);
    expect(
      validFactText("The Argive mothers seek burial for their sons."),
    ).toBe(true);
    expect(
      factDelivered(
        "The Argive mothers seek burial for their sons!",
        "The Argive mothers seek burial for their sons.",
      ),
    ).toBe(true);
  });

  it("lets the actor tell their own deed in the first person or another tense", () => {
    const fact = "Vale takes the Lamp.";
    for (const told of [
      "I take the Lamp.",
      "I took the lamp. It was warm.",
      "Well. Vale takes the Lamp!",
    ])
      expect(factDelivered(told, fact, "Vale", "Pip"), told).toBe(true);
    for (const wrong of [
      "I took the bell.",
      "I took the lamp from Pip.",
      "I never took the lamp.",
      "I took",
      "Pip took the lamp.",
    ])
      expect(factDelivered(wrong, fact, "Vale", "Pip"), wrong).toBe(false);
    expect(
      factDelivered(
        "You gave the lamp to me.",
        "Pip gives the Lamp to Vale.",
        "Vale",
        "Pip",
      ),
    ).toBe(true);
    expect(
      factDelivered(
        "You gave the cloth to me.",
        "Pip gives the Lamp to Vale.",
        "Vale",
        "Pip",
      ),
    ).toBe(false);
    expect(
      factDelivered("I had my lamp.", "Vale has Pip's Lamp.", "Vale", "Pip"),
    ).toBe(false);
    expect(
      factDelivered(
        "I was beside the pond.",
        "Vale is beside the pond.",
        "Vale",
        "Pip",
      ),
    ).toBe(true);
    // Without names the old third-person rule still holds.
    expect(factDelivered("I took the lamp.", fact)).toBe(false);
  });

  it("folds fact words exactly as the Rust speech check does", () => {
    // The same vectors run against fact_words in card_narrative/knowledge.rs.
    for (const [sentence, folded] of [
      ["Vale takes the Lamp.", "i tak lamp"],
      ["I took the lamp", "i tak lamp"],
      ["Pip gives the Lamp to Vale.", "you giv lamp to i"],
      ["Vale's dropped shells were mossy.", "i drop shel be mossi"],
      ["The Argive mothers seek burial.", "argiv mother seek burial"],
    ])
      expect(factWords(sentence, "Vale", "Pip"), sentence).toBe(folded);
  });

  it("keeps authored knowledge through bounded news churn", () => {
    const w = bare();
    w.turn = 1;
    const topic = {
      id: "public-petition",
      speaker: "moth",
      at: "station",
      text: "The families ask the city for a burial.",
      packId: "sample",
    };
    speech(w, talk(w, "moth", "vale", [topic]));
    source(w);
    for (let i = 0; i < KNOWLEDGE_FACT_LIMIT + 5; i++)
      source(w, { text: `Pip carried shell number ${i} to the pond.` });
    expect(Object.keys(w.knowledge.facts)).toHaveLength(KNOWLEDGE_FACT_LIMIT);
    expect(knowsFact(w, "vale", topic.id)).toBe(true);
    expect(validKnowledge(w, Object.keys(w.actors), ["station"], [topic])).toBe(
      true,
    );
  });

  it("validates source, teller, and pending references strictly", () => {
    const w = bare();
    source(w);
    w.turn = 1;
    speech(w, talk(w));
    for (const change of [
      (v) => {
        v.knowledge.extra = true;
      },
      (v) => {
        Object.values(v.knowledge.facts)[0].source.actorId = "missing";
      },
      (v) => {
        Object.values(v.knowledge.known.vale)[0].teller = "vale";
      },
      (v) => {
        Object.values(v.knowledge.known.vale)[0].eventSeq = v.eventSeq + 1;
      },
    ]) {
      const copy = structuredClone(w);
      change(copy);
      expect(validKnowledge(copy, Object.keys(copy.actors), ["station"])).toBe(
        false,
      );
    }
  });

  it("keeps topic prerequisites on gossip and permits a later source confirmation", () => {
    const w = bare();
    w.turn = 1;
    const topic = {
      id: "public-petition",
      speaker: "moth",
      at: "station",
      packId: "sample",
      choiceId: "record-petition",
      text: "The families ask the city for a burial.",
    };
    const first = talk(w, "moth", "vale", [topic]);
    expect(speech(w, first)[0].learned).toBe(true);
    expect(talk(w, "moth", "keeper", [])).toEqual([]);
    w.turn = 2;
    expect(talk(w, "vale", "keeper", [topic])).toHaveLength(1);
    const confirmation = talk(w, "moth", "vale", [
      { ...topic, choiceReady: true },
    ]);
    expect(confirmation[0].factId).toBe(topic.id);
    expect(speech(w, confirmation)[0]).toMatchObject({
      learned: false,
      commitChoice: true,
    });
    expect(w.knowledge.known.vale[topic.id].teller).toBe("moth");
  });
  it("keeps a topic's receipt from becoming a second news origin", () => {
    const w = bare();
    const topic = {
      id: "public-petition",
      speaker: "moth",
      at: "station",
      packId: "sample",
      choiceId: "record-petition",
      text: "The families ask the city for a burial.",
    };
    const entry = {
      seq: ++w.eventSeq,
      turn: 0,
      kind: "action",
      verb: "choose",
      actorId: "vale",
      locationId: "station",
      cast: ["vale", "moth"],
      text: topic.text,
      packId: topic.packId,
      choiceId: topic.choiceId,
    };
    expect(witnessKnowledge(w, entry, undefined, [topic])).toBeNull();
    expect(Object.keys(w.knowledge.facts)).toEqual([]);
    delete w.knowledge;
    w.log = [entry];
    installKnowledge(w, undefined, [topic]);
    expect(Object.keys(w.knowledge.facts)).toEqual([]);
    w.turn = 1;
    const disclosure = talk(w, "moth", "vale", [topic]);
    expect(speech(w, disclosure)).toHaveLength(1);
    expect(Object.keys(w.knowledge.facts)).toEqual([topic.id]);
  });
});

describe("Talk publication and learned facts", () => {
  it("adds one saved learned fact after accepted local speech and reuses it after reload", () => {
    let { world, context } = localTalk(worldWithNews());
    const id = context.disclosures[0].factId;
    const pending = structuredClone(world.knowledge.pending);
    const irrelevant = applyGeneratedText(
      world,
      context,
      response(context, "I enjoy the warm breeze."),
    );
    expect(knowsFact(irrelevant, "vale", id)).toBe(false);
    expect(irrelevant.knowledge.pending).toEqual(pending);
    world = applyGeneratedText(world, context, response(context, clause));
    expect(knowsFact(world, "vale", id)).toBe(true);
    const restored = decodeSave(encodeSave(world));
    expect(restored.knowledge).toEqual(world.knowledge);
    // Vale already knows it; the cast may still pass it on among themselves.
    expect(
      (localTalk(restored).context.disclosures || []).filter(
        (d) => d.listener === "vale",
      ),
    ).toEqual([]);
  });

  it("migrates retained source events once and preserves later publication provenance", () => {
    let world = worldWithNews();
    delete world.knowledge;
    world = decodeSave(JSON.stringify(world));
    expect(Object.keys(world.knowledge.facts)).toEqual(["event:2"]);
    expect(knowsFact(world, "vale", "event:2")).toBe(false);
    const { world: next, context } = localTalk(world);
    const accepted = applyGeneratedText(
      next,
      context,
      response(context, clause),
    );
    expect(decodeSave(encodeSave(accepted)).knowledge).toEqual(
      accepted.knowledge,
    );
    expect(installKnowledge(accepted)).toBe(accepted.knowledge);
  });

  it("uses the same saved disclosure on shared publication", () => {
    let world = worldWithNews();
    const request = (op, extra = {}) =>
      dispatchShared({
        op,
        world,
        actor: "vale",
        claimed: ["vale"],
        present: ["vale"],
        ...extra,
      });
    const action = request("view").actions.find(
      (a) => a.kind === "talk" && a.target === "moth",
    );
    const played = request("play", { action });
    world = played.world;
    const ds = sharedContext({
      world,
      actor: "vale",
      claimed: ["vale"],
      present: ["vale"],
      action,
    }).disclosures;
    expect(knowsFact(world, "vale", ds[0].factId)).toBe(false);
    const spoken = request("speech", {
      room: "station",
      disclosures: ds,
      lines: [
        { actorId: "vale", text: "What did you find?" },
        { actorId: "moth", text: clause },
      ],
    });
    expect(knowsFact(spoken.world, "vale", ds[0].factId)).toBe(true);
    expect(decodeSave(encodeSave(spoken.world)).knowledge).toEqual(
      spoken.world.knowledge,
    );
  });
});

describe("authored topics keep their saved deed identity", () => {
  const pack = packDefinition("greek-drama");
  const originalTopics = pack.topics;
  // The mothers' request now commits on meeting Aethra. These cases stand it
  // in for a choice that commits through its Talk topic.
  const mothers = pack.choices.find(
    (c) => c.id === "greek-open-door-hear-mothers",
  );
  beforeEach(() => delete mothers.on);
  afterEach(() => {
    mothers.on = "meet";
    if (originalTopics === undefined) delete pack.topics;
    else pack.topics = originalTopics;
  });
  it("records the plea's receipt once at the Talk and teaches it from the words", () => {
    const choice = pack.choices.find(
      (c) => c.id === "greek-open-door-hear-mothers",
    );
    const text =
      "The Argive mothers ask Athens to recover their sons for burial.";
    pack.topics = [
      {
        id: choice.id,
        speaker: choice.subject,
        at: choice.at,
        text,
        requires: choice.requires,
        choiceId: choice.id,
      },
    ];
    let world = openDoorWalk(openDoorStart(), "harbor", "athens", "eleusis");
    const action = legalActions(world).find(
      (a) => a.kind === "talk" && a.target === "greek-aethra",
    );
    world = play(world, action).state;
    const context = narrativeContext(world, action);
    expect(context.disclosures[0].factId).toBe(choice.id);
    expect(world.packs[pack.id].receipts[choice.id]).toBe(world.turn);
    expect(knowsFact(world, "vale", choice.id)).toBe(false);
    world = applyGeneratedText(world, context, response(context, text));
    expect(knowsFact(world, "vale", choice.id)).toBe(true);
    expect(world.packs[pack.id].receipts[choice.id]).toBe(world.turn);
    const restored = decodeSave(encodeSave(world));
    expect(restored.packs[pack.id].receipts[choice.id]).toBe(world.turn);
    expect(restored.knowledge.known.vale[choice.id].teller).toBe(
      "greek-aethra",
    );
  });

  it("lets a resident who seeks Vale out tell the plea without making her choice", () => {
    const choice = pack.choices.find(
      (c) => c.id === "greek-open-door-hear-mothers",
    );
    const text =
      "The Argive mothers ask Athens to recover their sons for burial.";
    pack.topics = [
      {
        id: choice.id,
        speaker: choice.subject,
        at: choice.at,
        text,
        requires: choice.requires,
        choiceId: choice.id,
      },
    ];
    let world = openDoorWalk(openDoorStart(), "harbor", "athens", "eleusis");
    // Aethra's own quest is to talk with Vale, so she speaks first.
    world.actors[choice.subject].want = {
      kind: "person",
      target: "vale",
      since: world.turn,
      refusals: 0,
    };
    // The roaming Bard stays at Marathon this turn instead of walking in.
    world.actors["greek-rhapsode"].want = {
      kind: "place",
      target: "greek-marathon",
      since: world.turn,
      refusals: 0,
    };
    const wait = legalActions(world).find((a) => a.kind === "wait");
    world = play(world, wait).state;
    expect(
      world.log.some(
        (e) =>
          e.turn === world.turn &&
          e.verb === "talk" &&
          e.actorId === choice.subject,
      ),
    ).toBe(true);
    let context = narrativeContext(world, wait);
    expect(context.disclosures[0].factId).toBe(choice.id);
    world = applyGeneratedText(world, context, response(context, text));
    // She tells it; the choice stays Vale's own deed for her own Talk.
    expect(knowsFact(world, "vale", choice.id)).toBe(true);
    expect(world.packs[pack.id].receipts[choice.id]).toBeUndefined();
    const talk = legalActions(world).find(
      (a) => a.kind === "talk" && a.target === choice.subject,
    );
    world = play(world, talk).state;
    context = narrativeContext(world, talk);
    expect(context.disclosures[0].factId).toBe(choice.id);
    world = applyGeneratedText(world, context, response(context, text));
    expect(world.packs[pack.id].receipts[choice.id]).toBe(world.turn);
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });

  it("records the source scene after its public fact was learned earlier", () => {
    const choice = pack.choices.find(
      (c) => c.id === "greek-open-door-hear-mothers",
    );
    const topic = {
      id: choice.id,
      speaker: choice.subject,
      at: choice.at,
      text: "The Argive mothers ask Athens to recover their sons for burial.",
      requires: choice.requires,
      choiceId: choice.id,
    };
    pack.topics = [topic];
    let world = openDoorWalk(openDoorStart(), "harbor", "athens", "eleusis");
    const entry = { seq: ++world.eventSeq, turn: world.turn };
    reserveKnowledge(world, topic.speaker, "vale", entry, [
      { ...topic, packId: pack.id },
    ]);
    const earlier = knowledgeDisclosures(
      world,
      [topic.speaker],
      [topic.speaker, "vale"],
      topic.at,
    );
    addLog(world, "Aethra", topic.text, {
      generated: true,
      kind: "dialogue",
      actorId: topic.speaker,
      locationId: topic.at,
      cast: [topic.speaker, "vale"],
    });
    acceptKnowledgeSpeech(world, world.log.at(-1), earlier);
    expect(knowsFact(world, "vale", topic.id)).toBe(true);
    expect(world.packs[pack.id].receipts[choice.id]).toBeUndefined();
    const action = legalActions(world).find(
      (a) => a.kind === "talk" && a.target === topic.speaker,
    );
    world = play(world, action).state;
    const context = narrativeContext(world, action);
    expect(context.disclosures[0].factId).toBe(topic.id);
    world = applyGeneratedText(world, context, response(context, topic.text));
    expect(
      decodeSave(encodeSave(world)).packs[pack.id].receipts[choice.id],
    ).toBe(world.turn);
  });
});

describe("told facts by age", () => {
  const names = { moth: "Pip", station: "the Station" };
  const nameOf = (id) => names[id] || id;

  it("names an age band and the place, and warns once news is stale", () => {
    const w = bare();
    source(w);
    expect(knowledgeFacts(w, "moth", nameOf)).toEqual([
      `I witnessed this just now at the Station: ${clause}`,
    ]);
    w.turn = 4;
    expect(knowledgeFacts(w, "moth", nameOf)[0]).toMatch(
      /^I witnessed this a little while ago at the Station: /u,
    );
    w.turn = 12;
    expect(knowledgeFacts(w, "moth", nameOf)[0]).toBe(
      `I witnessed this some time ago at the Station: ${clause} Things may have changed since.`,
    );
  });

  it("uses bands, not turn numbers", () => {
    expect([0, 1, 2, 5, 6, 20, 21].map(ageText)).toEqual([
      "just now",
      "just now",
      "a little while ago",
      "a little while ago",
      "some time ago",
      "some time ago",
      "long ago",
    ]);
  });
});
