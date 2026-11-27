import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newKnowledge,
  installKnowledge,
  witnessKnowledge,
  reserveKnowledge,
  reserveLaneKnowledge,
  commitDisclosure,
  learnQuest,
  questFactId,
  readClaim,
  knowledgeDisclosures,
  knowsFact,
  validKnowledge,
  validFactText,
  KNOWLEDGE_FACT_LIMIT,
  GRIEVANCE_PIN_LIMIT,
  GRIEVANCE_DORMANT_TURNS,
  pinnedFacts,
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
} from "../v2/card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { sharedContext } from "../v2/card-game/shared-narrator.mjs";
import { packDefinition, packDefinitions } from "../v2/card-game/pack-registry.mjs";
import { greekStart, openDoorWalk } from "./helpers/open-door.mjs";

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
const marker = ({ factId, speaker, listener, eventSeq }) => ({
  factId,
  speaker,
  listener,
  eventSeq,
});
const reveal = (w, [disclosure]) => {
  const { speaker } = disclosure;
  expect(commitDisclosure(w, marker(disclosure), speaker, w.actors[speaker].place))
    .toBeTruthy();
};
const worldWithNews = () => {
  const w = createWorld();
  for (const id of ["vale", "moth", "keeper"]) w.actors[id].place = "station";
  // Keep the Wayfinder home so the station does not add a return quest.
  w.items["elysium-wayfinder"].holder = "station";
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
const response = (context, words, disclosed) => {
  const [{ speaker }] = context.disclosures;
  return {
    revision: context.revision,
    model: "fixture",
    entries: context.entities.map(({ id }) => ({
      id,
      text: id === speaker ? words : "I am glad to see you.",
      ...(id === speaker && disclosed ? { disclosed } : {}),
    })),
  };
};

describe("saved public knowledge", () => {
  it("teaches an absent witness only when the Talk's disclosure is committed", () => {
    const w = bare();
    const fact = source(w);
    expect(knowsFact(w, "moth", fact.id)).toBe(true);
    expect(knowsFact(w, "vale", fact.id)).toBe(false);
    w.turn = 1;
    const offered = talk(w);
    expect(offered).toMatchObject([{ factId: fact.id, deferred: true }]);
    expect(knowsFact(w, "vale", fact.id)).toBe(false);
    expect(validKnowledge(w, Object.keys(w.actors), ["station"])).toBe(true);
    reveal(w, offered);
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
    w.turn = 2;
    expect(talk(w)).toEqual([]);
    expect(validKnowledge(w, Object.keys(w.actors), ["station"])).toBe(true);
  });

  it("checks the reserved pair, fact, turn, and event before accepting a disclosure", () => {
    const w = bare(), fact = source(w);
    w.turn = 1;
    const [offered] = talk(w);
    const stamp = marker(offered);
    expect(commitDisclosure(w, stamp, "vale", "station")).toBeNull();
    for (const invalid of [
      { ...stamp, listener: "keeper" },
      { ...stamp, factId: "event:1" },
      { ...stamp, eventSeq: stamp.eventSeq - 1 },
    ]) expect(commitDisclosure(w, invalid, "moth", "station")).toBeNull();
    expect(commitDisclosure(w, stamp, "moth", "pond")).toBeNull();
    expect(knowsFact(w, "vale", fact.id)).toBe(false);

    w.turn = 2;
    expect(commitDisclosure(w, stamp, "moth", "station")).toBeNull();
    const retry = talk(w);
    expect(retry[0].eventSeq).toBeGreaterThan(stamp.eventSeq);
    reveal(w, retry);
    expect(knowsFact(w, "vale", fact.id)).toBe(true);
    expect(commitDisclosure(w, marker(retry[0]), "moth", "station")).toBeNull();
  });

  it("tells the next fact on a second Talk, then nothing", () => {
    const w = bare(),
      first = source(w),
      second = source(w, { text: "Pip carried a shell to the pond." });
    w.turn = 1;
    let offered = talk(w);
    expect(offered[0].factId).toBe(second.id);
    reveal(w, offered);
    expect(knowsFact(w, "vale", first.id)).toBe(false);
    w.turn = 2;
    offered = talk(w);
    expect(offered[0].factId).toBe(first.id);
    reveal(w, offered);
    w.turn = 3;
    expect(talk(w)).toEqual([]);
  });

  it("shares a current request and a book claim over successive Talks despite newer news", () => {
    const w = bare();
    const request = { kind: "item", target: "lamp" };
    const current = questFactId("keeper", request);
    const former = questFactId("keeper", { kind: "item", target: "bell" });
    const claim = "claim:sample:river-book:ford";
    w.actors.keeper.want = request;
    for (const [id, text] of [
      [former, "The keeper wants the Bell."],
      [current, "The keeper wants the Lamp."],
    ]) {
      learnQuest(w, "keeper", "moth", { id, text }, { seq: ++w.eventSeq, turn: w.turn });
    }
    readClaim(w, "moth", {
      id: claim, text: "The nearest ford lies beneath the old quay.",
      book: "river-book", claim: "ford", author: "keeper", about: "station",
    }, { seq: ++w.eventSeq, turn: w.turn });

    for (const [index, expected] of [current, claim].entries()) {
      w.turn++;
      source(w, { text: `Pip brought shell ${index} from the pond.` });
      const offered = talk(w);
      expect(offered.map(({ factId }) => factId)).toEqual([expected]);
      reveal(w, offered);
    }
    w.turn++;
    const news = source(w, { text: "Pip carried one more shell from the pond." });
    expect(talk(w).map(({ factId }) => factId)).toEqual([news.id]);
    expect(knowsFact(w, "vale", former)).toBe(false);
    expect(w.knowledge.known.vale[claim]).toMatchObject({ kind: "heard", teller: "moth" });
  });

  it("uses one hop per round and keeps the immediate teller on each hop", () => {
    const w = bare(),
      fact = source(w);
    w.turn = 1;
    reveal(w, talk(w));
    expect(talk(w, "vale", "keeper")).toEqual([]);
    expect(knowsFact(w, "keeper", fact.id)).toBe(false);
    w.turn = 2;
    reveal(w, talk(w, "vale", "keeper"));
    expect(w.knowledge.known.keeper[fact.id]).toMatchObject({
      kind: "heard",
      teller: "vale",
      learnedTurn: 2,
    });
    expect(w.knowledge.facts[fact.id].source.actorId).toBe("moth");
  });

  it("withholds a fact from a listener in another place", () => {
    const w = bare(),
      fact = source(w);
    w.turn = 1;
    w.actors.vale.place = "pond";
    expect(talk(w)).toEqual([]);
    expect(knowsFact(w, "vale", fact.id)).toBe(false);
  });

  it("lets a lane heard this turn pass on only on a later turn", () => {
    const w = bare();
    w.actors = {
      pip: { place: "pond" },
      rue: { place: "pond" },
      ada: { place: "pond" },
    };
    const lane = {
      id: "lane:pond>harbor",
      text: "A boat runs from the pond to the harbor.",
    };
    const ok = () =>
      validKnowledge(w, ["pip", "rue", "ada"], ["pond"], [], (id) =>
        id === lane.id ? lane.text : null,
      );
    w.turn = 1;
    const entry = () => ({ seq: ++w.eventSeq, turn: w.turn });
    const first = reserveLaneKnowledge(w, "pip", "rue", entry(), lane);
    expect(knowsFact(w, "rue", lane.id)).toBe(false);
    reveal(w, [first]);
    expect(reserveLaneKnowledge(w, "rue", "ada", entry(), lane)).toBeNull();
    expect(knowsFact(w, "ada", lane.id)).toBe(false);
    expect(ok()).toBe(true);
    w.turn = 2;
    const later = reserveLaneKnowledge(w, "rue", "ada", entry(), lane);
    reveal(w, [later]);
    expect(w.knowledge.known.ada[lane.id]).toMatchObject({
      kind: "heard",
      teller: "rue",
    });
    expect(ok()).toBe(true);
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
    reveal(w, talk(w, "moth", "vale", [{ ...topic, said: true }]));
    source(w);
    for (let i = 0; i < KNOWLEDGE_FACT_LIMIT + 5; i++)
      source(w, { text: `Pip carried shell number ${i} to the pond.` });
    expect(Object.keys(w.knowledge.facts)).toHaveLength(KNOWLEDGE_FACT_LIMIT);
    expect(knowsFact(w, "vale", topic.id)).toBe(true);
    expect(validKnowledge(w, Object.keys(w.actors), ["station"], [topic])).toBe(
      true,
    );
  });

  it.each([
    ["by its incident id", { turn: 0, incident: "event:2" }],
    ["in an old save without an id", { turn: 1 }],
  ])("keeps the incident under a standing grievance %s", (_, held) => {
    const w = bare();
    w.turn = 1;
    const fight = source(w, {
      verb: "threaten",
      actorId: "vale",
      cast: ["vale", "moth"],
      witnesses: ["vale", "moth"],
      text: "Vale threatens Pip over the Black cloth.",
    });
    w.motives = {
      version: 1,
      grievances: {
        moth: [
          {
            other: "vale",
            kind: "threat",
            reason: "Vale picked a fight.",
            weight: 1,
            ...held,
          },
        ],
      },
    };
    expect(fight.id).toBe("event:2");
    w.turn = 2;
    const next = source(w, {
      text: "Pip carried the first shell to the pond.",
    });
    for (let i = 0; i < KNOWLEDGE_FACT_LIMIT - 2; i++)
      source(w, { text: `Pip carried shell number ${i} to the pond.` });
    expect(Object.keys(w.knowledge.facts)).toHaveLength(KNOWLEDGE_FACT_LIMIT);
    source(w, { text: "Pip carried one more shell to the pond." });
    expect(Object.keys(w.knowledge.facts)).toHaveLength(KNOWLEDGE_FACT_LIMIT);
    expect(knowsFact(w, "moth", fight.id)).toBe(true);
    expect(w.knowledge.facts[next.id]).toBeUndefined();
    // A grievance that is gone releases the pin. (A gift no longer clears
    // one: a witnessed repair keeps it, dormant, with its pin.)
    w.motives.grievances.moth = [];
    source(w, { text: "Pip carried a last shell to the pond." });
    expect(w.knowledge.facts[fight.id]).toBeUndefined();
    expect(Object.keys(w.knowledge.facts)).toHaveLength(KNOWLEDGE_FACT_LIMIT);
  });

  it("caps grievance pins at half the store and keeps fresh news", () => {
    // 66 avatars, each holding six grievances: 10 active, 20 dormant and 36
    // repaired holders. Their incidents are the oldest news in the store.
    const ids = Array.from({ length: 66 }, (_, i) => `a${i}`);
    const w = {
      ...bare(),
      turn: 100,
      actors: Object.fromEntries(ids.map((id) => [id, { place: "station" }])),
      motives: { version: 1, grievances: {} },
    };
    const status = (h) => (h < 10 ? "active" : h < 30 ? "dormant" : "repaired");
    let seq = w.eventSeq;
    const plays = [];
    // Insert holders in reverse so output never leans on key order.
    for (let h = 65; h >= 0; h--) w.motives.grievances[ids[h]] = [];
    ids.forEach((holder, h) => {
      for (let i = 0; i < 6; i++) {
        const other = ids[(h + i + 1) % 66];
        const incident = `event:${++seq}`;
        plays.push({ holder, other });
        w.motives.grievances[holder].push({
          other,
          kind: "threat",
          reason: "A fight.",
          turn: 0,
          weight: 1,
          incident,
          repaired: status(h) === "repaired",
          lastTouched:
            status(h) === "active"
              ? w.turn - (h % 5)
              : w.turn - GRIEVANCE_DORMANT_TURNS - h * 6 - i,
        });
      }
    });
    plays.forEach(({ holder, other }, k) =>
      expect(
        source(w, {
          actorId: other,
          cast: [other],
          witnesses: [holder, other],
          text: `Fight number ${k} broke out by the pond.`,
        })?.id,
      ).toBe(`event:${seq - plays.length + k + 1}`),
    );
    const fresh = Array.from({ length: 100 }, (_, k) =>
      source(w, {
        actorId: "a0",
        cast: ["a0"],
        witnesses: ["a0"],
        text: `Pip carried fresh shell ${k} to the pond.`,
      }),
    );
    const facts = w.knowledge.facts;
    expect(Object.keys(facts)).toHaveLength(KNOWLEDGE_FACT_LIMIT);
    expect(fresh.every((f) => facts[f.id])).toBe(true);
    const pinned = pinnedFacts(w);
    expect(pinned.size).toBe(GRIEVANCE_PIN_LIMIT);
    const kept = (h) =>
      w.motives.grievances[ids[h]].filter(
        (g) => facts[g.incident] && pinned.has(g.incident),
      ).length;
    // Every active grievance keeps its evidence; dormant ones keep theirs by
    // most recent touch; no repaired one holds a pin while others need it.
    for (let h = 0; h < 10; h++) expect(kept(h), ids[h]).toBe(6);
    const dormant = Array.from({ length: 20 }, (_, d) => kept(10 + d));
    expect(dormant.reduce((n, k) => n + k, 0)).toBe(GRIEVANCE_PIN_LIMIT - 60);
    expect(dormant).toEqual([...dormant].sort((a, b) => b - a));
    expect(dormant[0]).toBe(6);
    expect(dormant.at(-1)).toBe(0);
    for (let h = 30; h < 66; h++) expect(kept(h), ids[h]).toBe(0);
    // The same grievances in another key order pin the same facts.
    const shuffled = structuredClone(w);
    shuffled.motives.grievances = Object.fromEntries(
      Object.entries(w.motives.grievances).reverse(),
    );
    expect([...pinnedFacts(shuffled)].sort()).toEqual([...pinned].sort());
  });

  it("still bounds the store when every aging fact is grievance evidence", () => {
    const w = bare();
    w.turn = 1;
    w.motives = {
      version: 1,
      grievances: {
        vale: [
          {
            other: "moth",
            kind: "threat",
            reason: "Pip picked a fight.",
            turn: 1,
            weight: 1,
          },
        ],
      },
    };
    const first = source(w, {
      witnesses: ["moth", "vale"],
      text: "Pip carried shell number first to the pond.",
    });
    for (let i = 0; i < KNOWLEDGE_FACT_LIMIT; i++)
      source(w, {
        witnesses: ["moth", "vale"],
        text: `Pip carried shell number ${i} to the pond.`,
      });
    expect(Object.keys(w.knowledge.facts)).toHaveLength(KNOWLEDGE_FACT_LIMIT);
    expect(w.knowledge.facts[first.id]).toBeUndefined();
  });

  it("validates source, teller, and pending references strictly", () => {
    const w = bare();
    source(w);
    w.turn = 1;
    const offered = talk(w);
    const broken = structuredClone(w);
    broken.knowledge.pending[0].eventSeq = broken.eventSeq + 1;
    expect(validKnowledge(broken, Object.keys(broken.actors), ["station"])).toBe(false);
    reveal(w, offered);
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

  it("says a topic only at its Talk choice and keeps its prerequisites on gossip", () => {
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
    expect(talk(w, "moth", "vale", [topic])).toEqual([]);
    expect(w.knowledge.facts[topic.id]).toBeUndefined();
    reveal(w, talk(w, "moth", "vale", [{ ...topic, said: true }]));
    expect(knowsFact(w, "vale", topic.id)).toBe(true);
    expect(talk(w, "moth", "keeper", [])).toEqual([]);
    w.turn = 2;
    const forwarded = talk(w, "vale", "keeper", [topic]);
    expect(w.knowledge.pending.at(-1).commitChoice).toBe(false);
    reveal(w, forwarded);
    expect(w.knowledge.known.keeper[topic.id].teller).toBe("vale");
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
    expect(talk(w, "moth", "vale", [{ ...topic, said: true }])).toHaveLength(1);
    expect(Object.keys(w.knowledge.facts)).toEqual([topic.id]);
  });
});

describe("Talk publication and learned facts", () => {
  it("can retry local Talk when the reply leaves its fact unspoken", () => {
    const { world, context } = localTalk(worldWithNews());
    const disclosure = context.disclosures[0];
    expect(disclosure).toMatchObject({ text: clause, deferred: true });
    expect(knowsFact(world, "vale", disclosure.factId)).toBe(false);
    const missingReply = response(context, "I enjoy the warm breeze.");
    missingReply.entries = missingReply.entries.filter(({ id }) => id !== disclosure.speaker);
    expect(applyGeneratedText(world, context, missingReply).knowledge).toEqual(world.knowledge);
    const unrelated = applyGeneratedText(
      world,
      context,
      response(context, "I enjoy the warm breeze."),
    );
    expect(unrelated.knowledge).toEqual(world.knowledge);
    const restored = decodeSave(encodeSave(unrelated));
    expect(restored.knowledge).toEqual(unrelated.knowledge);
    const retry = localTalk(restored);
    const next = retry.context.disclosures[0];
    expect(next).toMatchObject({ factId: disclosure.factId, speaker: "moth", listener: "vale" });
    expect(next.eventSeq).toBeGreaterThan(disclosure.eventSeq);
    const spoken = applyGeneratedText(
      retry.world,
      retry.context,
      response(retry.context, "You should see the shell I picked up by the water.", marker(next)),
    );
    expect(knowsFact(spoken, "vale", disclosure.factId)).toBe(true);
    expect(
      (localTalk(decodeSave(encodeSave(spoken))).context.disclosures || []).filter(
        (d) => d.listener === "vale",
      ),
    ).toEqual([]);
  });

  it("commits a local streamed disclosure on final delivery without repeating the line", () => {
    const { world, context } = localTalk(worldWithNews());
    const offered = context.disclosures[0];
    const words = "I picked up a little shell at the water's edge.";
    const options = { incremental: true, preservePublished: true };
    const streamed = applyGeneratedText(world, context, response(context, words), options);
    expect(knowsFact(streamed, "vale", offered.factId)).toBe(false);
    const mismatch = applyGeneratedText(
      streamed, context, response(context, `${words} Come look.`, marker(offered)), options,
    );
    expect(knowsFact(mismatch, "vale", offered.factId)).toBe(false);
    const finalReply = response(context, words, marker(offered));
    const completed = applyGeneratedText(streamed, context, finalReply, options);
    expect(knowsFact(completed, "vale", offered.factId)).toBe(true);
    const lines = completed.log.filter((line) => line.generated && line.text === words);
    expect(lines).toHaveLength(1);
    expect(lines[0].disclosedFactId).toBe(offered.factId);
    const replayed = applyGeneratedText(completed, context, finalReply, options);
    expect(replayed.knowledge).toEqual(completed.knowledge);
    expect(replayed.log).toEqual(completed.log);
  });

  it("records a shared disclosure only from the reserved speaker and event", () => {
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
    const [offered] = ds;
    expect(offered).toMatchObject({ text: clause, deferred: true });
    expect(knowsFact(world, "vale", offered.factId)).toBe(false);
    const stamp = marker(offered);
    const speak = (lines) => request("speech", { room: "station", lines }).world;
    const reply = { actorId: "moth", text: "I found a small shell right by the water." };
    for (const line of [
      reply,
      { ...reply, disclosed: { ...stamp, eventSeq: stamp.eventSeq - 1 } },
      { actorId: "vale", text: "Did you find something?", disclosed: stamp },
    ]) {
      const unrelated = speak([line]);
      expect(knowsFact(unrelated, "vale", offered.factId)).toBe(false);
    }
    const spoken = speak([{ ...reply, disclosed: stamp }]);
    expect(spoken.knowledge.known.vale[offered.factId]).toMatchObject({
      kind: "heard", teller: "moth", eventSeq: offered.eventSeq,
    });
    const restored = decodeSave(encodeSave(spoken));
    expect(restored.knowledge).toEqual(spoken.knowledge);
    expect(restored.log.findLast((line) => line.text === reply.text).disclosedFactId)
      .toBe(offered.factId);
  });
});

describe("learned facts in the avatar's own view", () => {
  const seen = (w, text) =>
    addLog(w, "World", text, {
      kind: "action",
      verb: "give",
      actorId: "moth",
      locationId: "station",
      cast: ["moth", "vale"],
      witnesses: ["moth", "vale"],
    });
  const view = (w) => {
    const action = legalActions(w).find((a) => a.kind === "wait");
    const next = play(w, action).state;
    return narrativeContext(next, action).entities.find((e) => e.id === "vale")
      .facts;
  };
  it("keeps a told fact in view on later turns", () => {
    let { world, context } = localTalk(worldWithNews());
    world = applyGeneratedText(
      world, context, response(context, "I found a shell at the pond.", marker(context.disclosures[0])),
    );
    for (let i = 0; i < 3; i++)
      world = play(
        world,
        legalActions(world).find((a) => a.kind === "wait"),
      ).state;
    expect(view(world).filter((f) => f.endsWith(clause))).toEqual([
      `Pip told me this a little while ago at Empty station: ${clause}`,
    ]);
  });
  it("keeps only the two newest witnessed events", () => {
    const world = worldWithNews();
    for (let i = 0; i < 20; i++)
      seen(world, `Pip carried shell number ${i} to the pond.`);
    const shells = view(world).filter((f) => f.includes("shell number"));
    expect(shells.map((f) => f.match(/number (\d+)/u)[1])).toEqual([
      "19",
      "18",
    ]);
  });
  it("keeps every told fact newest first, and drops the oldest over the cap", () => {
    const w = bare();
    for (let i = 0; i < 20; i++) {
      w.turn = i;
      source(w, { text: `Pip carried shell number ${i} to the pond.` });
      w.turn = i + 1;
      reveal(w, talk(w));
    }
    const names = (n) =>
      knowledgeFacts(w, "vale", undefined, [], n).map(
        (f) => f.match(/^moth told me .* number (\d+) /u)?.[1],
      );
    expect(names(20)).toEqual(
      Array.from({ length: 20 }, (_, i) => `${19 - i}`),
    );
    expect(names(4)).toEqual(["19", "18", "17", "16"]);
    expect(knowledgeFacts(w, "vale", undefined, ["event:2"], 4)[0]).toContain(
      "number 0 ",
    );
  });
});

describe("authored topics are said at their Talk choice", () => {
  const pack = packDefinition("greek-drama");
  const originalTopics = pack.topics;
  // The guard's decree commits on meeting him. These cases make it a Talk
  // choice with a topic.
  const decree = pack.choices.find((c) => c.id === "greek-hear-decree");
  const topic = {
    id: decree.id,
    speaker: decree.subject,
    at: decree.at,
    text: "A public decree forbids burial of the brother left outside the city.",
    requires: decree.requires,
    choiceId: decree.id,
  };
  beforeEach(() => {
    decree.on = "talk";
    pack.topics = [topic];
  });
  afterEach(() => {
    decree.on = "meet";
    if (originalTopics === undefined) delete pack.topics;
    else pack.topics = originalTopics;
  });
  it("gives every pack topic a Talk choice of its speaker at its place", () => {
    for (const p of packDefinitions)
      for (const t of p.topics || [])
        expect(p.choices.find((c) => c.id === t.choiceId), t.id).toMatchObject({
          on: "talk",
          subject: t.speaker,
          at: t.at,
        });
  });
  it("records the Talk choice and topic after the fact is revealed", () => {
    let world = openDoorWalk(greekStart(), "gate");
    const entry = { seq: ++world.eventSeq, turn: world.turn };
    reserveKnowledge(world, topic.speaker, "vale", entry, [
      { ...topic, packId: pack.id },
    ]);
    expect(world.knowledge.facts[topic.id]).toBeUndefined();
    const action = legalActions(world).find(
      (a) => a.kind === "talk" && a.target === topic.speaker,
    );
    world = play(world, action).state;
    const context = narrativeContext(world, action);
    expect(context.disclosures[0].factId).toBe(topic.id);
    expect(world.packs[pack.id].receipts[decree.id]).toBeUndefined();
    expect(knowsFact(world, "vale", topic.id)).toBe(false);
    world = applyGeneratedText(world, context, response(
      context,
      "The decree leaves his brother outside the walls without a burial.",
      marker(context.disclosures[0]),
    ));
    const restored = decodeSave(encodeSave(world));
    expect(restored.packs[pack.id].receipts[decree.id]).toBe(world.turn);
    expect(restored.knowledge.known.vale[topic.id].teller).toBe(topic.speaker);
    expect(restored.knowledge.known[topic.speaker][topic.id].kind).toBe(
      "witnessed",
    );
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
    for (let i = 0; i < 4; i++) source(w, { text: `Pip saw shell ${i} here.` });
    expect(knowledgeFacts(w, "moth", nameOf)).toHaveLength(2);
    expect(knowledgeFacts(w, "moth", nameOf, [], 9)).toHaveLength(2);
    w.knowledge.known.moth = { "event:2": w.knowledge.known.moth["event:2"] };
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
