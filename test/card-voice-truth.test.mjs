import { describe, expect, it } from "vitest";
import {
  REFUSAL_REASONS,
  carried,
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  nameOf,
  play,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  applyGeneratedText,
  narrativeContext,
} from "../v2/card-game/narrative.mjs";
import { wantOf } from "../v2/card-game/want.mjs";
import { dispatchShared, load } from "../v2/card-game/shared-world.mjs";
import { sharedContext } from "../v2/card-game/shared-narrator.mjs";

const CAST = { player: "vale", near: "keeper", far: "moth" };
const ITEMS = { offered: "bell", kept: "oil", spare: "cloth" };
const PLACES = { home: "pond", away: "station" };
const SHAPE = {
  holding: /^Holding: /u,
  witnessed: /^I witnessed /u,
  offer: /^(?:If .+ asked me for |I would (?:trade|accept) |No item )/u,
  refusal: / refused .+ \(refusal: ([a-z-]+)\)/u,
  exchange: /^Your completed exchange: /u,
};
const toldBy = (teller) => `${nameOf(teller)} told me `;
const FILLER = "I am here.";

const STEPS = [
  ["refusedGive", { kind: "give", item: ITEMS.offered, target: CAST.far }],
  ["refusedTrade", { kind: "trade", item: ITEMS.offered, receive: ITEMS.spare }],
  ["leave", { kind: "move", target: PLACES.away }],
  ["offer", { kind: "talk", target: CAST.near }],
  ["refusedAsk", { kind: "ask", item: ITEMS.kept, target: CAST.near }],
  ["exchange", { kind: "trade", item: ITEMS.offered, receive: ITEMS.kept }],
  ["back", { kind: "move", target: PLACES.home }],
  ["told", { kind: "talk", target: CAST.far }],
  ["away", { kind: "move", target: PLACES.away }],
  ["handBack", { kind: "give", item: ITEMS.kept, target: CAST.near }],
  ["revisit", { kind: "move", target: PLACES.home }],
  ["retold", { kind: "talk", target: CAST.far }],
  ["later", { kind: "wait" }],
  ["stale", { kind: "wait" }],
];
const REFUSALS = ["refusedGive", "refusedTrade", "refusedAsk"];
const CLAIM = {
  offer: () => `I give you the ${nameOf(ITEMS.kept)}.`,
  refusedAsk: () => `Take the ${nameOf(ITEMS.kept)}, it is yours now.`,
};

function seed() {
  const world = enableMotives(createWorld());
  world.actors[CAST.player].place = PLACES.home;
  world.actors[CAST.near].place = PLACES.home;
  world.actors[CAST.far].place = PLACES.home;
  world.items[ITEMS.offered].holder = CAST.player;
  world.items[ITEMS.kept].holder = CAST.near;
  world.items[ITEMS.spare].holder = CAST.far;
  world.actors[CAST.near].want = {
    kind: "item",
    target: ITEMS.offered,
    since: 0,
    refusals: 0,
  };
  world.actors[CAST.far].want = null;
  return world;
}

const seat = {
  actor: CAST.player,
  claimed: [CAST.player],
  present: [CAST.player],
};
const TABLES = {
  local: {
    start: (world) => world,
    read: (world) => world,
    actions: (world) => legalActions(world),
    play(world, action) {
      const result = play(world, action);
      expect(result.ok, result.error).toBe(true);
      return result.state;
    },
    context: (world, action) => narrativeContext(world, action),
    speak: (world, context, lines) =>
      applyGeneratedText(world, context, {
        revision: context.revision,
        model: "fixture",
        entries: lines.map(([id, text]) => ({ id, text })),
        omitted: context.entities
          .map((entity) => entity.id)
          .filter((id) => !lines.some(([speaker]) => speaker === id)),
      }),
    reload: (world) => decodeSave(encodeSave(world)),
  },
  shared: {
    start: (world) =>
      dispatchShared({ op: "create", save: encodeSave(world) }).world,
    read: (world) => load({ world, ...seat }),
    actions: (world) => dispatchShared({ op: "view", world, ...seat }).actions,
    play(world, action) {
      const result = dispatchShared({ op: "play", world, action, ...seat });
      expect(result.ok, result.error).toBe(true);
      return result.world;
    },
    context: (world, action) => sharedContext({ world, action, ...seat }),
    speak: (world, context, lines) =>
      dispatchShared({
        op: "speech",
        world,
        ...seat,
        room: context.location,
        disclosures: context.disclosures || [],
        lines: lines.map(([actorId, text]) => ({ actorId, text })),
      }).world,
    reload: (world) =>
      dispatchShared({ op: "validate", world: structuredClone(world), ...seat })
        .world,
  },
};

const voiced = (context, step, tell = true) =>
  context.speakers.map((id) => [
    id,
    tell && context.disclosures?.[0]?.speaker === id
      ? context.disclosures[0].text
      : id !== CAST.player && CLAIM[step]
        ? CLAIM[step]()
        : FILLER,
  ]);

function run(mode) {
  const table = TABLES[mode];
  let world = table.start(seed());
  const snaps = {
    start: { world: table.read(world), context: table.context(world, null) },
  };
  let before = snaps.start;
  for (const [step, fields] of STEPS) {
    const action = table
      .actions(world)
      .find((a) => Object.entries(fields).every(([k, v]) => a[k] === v));
    expect(action, `${mode} ${step}`).toBeDefined();
    world = table.play(world, action);
    const context = table.context(world, action);
    const seen = table.read(world);
    const snap = {
      step,
      before,
      world: seen,
      context,
      entry: seen.log.findLast(
        (e) => e.turn === seen.turn && e.verb === fields.kind && !e.generated,
      ),
    };
    if (context.speakers.length) {
      if (context.disclosures?.length)
        snap.unheard = table.read(
          table.speak(world, context, voiced(context, step, false)),
        );
      world = table.speak(world, context, voiced(context, step));
      snap.spoken = table.read(world);
    }
    snaps[step] = before = snap;
  }
  snaps.end = { world: table.read(world), stored: world };
  return snaps;
}

const entity = (snap, id) => snap.context.entities.find((e) => e.id === id);
const facts = (snap, id) => entity(snap, id)?.facts ?? [];
const avatars = (snap) =>
  Object.values(CAST).filter((id) => entity(snap, id));
const holders = (world) =>
  Object.fromEntries(
    Object.values(ITEMS).map((id) => [id, world.items[id].holder]),
  );
const holding = (snap, id) => facts(snap, id).filter((f) => SHAPE.holding.test(f));
const recalls = (snap, id, text) =>
  facts(snap, id).filter((f) => f.includes(text));
const provenance = (fact, tellers = Object.values(CAST)) =>
  SHAPE.witnessed.test(fact) || tellers.some((t) => fact.startsWith(toldBy(t)));
const eventFact = (snap) => snap.world.knowledge.facts[`event:${snap.entry.seq}`];
const projection = (snap) => ({
  outcome: snap.context.outcome,
  location: snap.context.location,
  speakers: snap.context.speakers,
  occasion: snap.context.occasion ?? null,
  action: snap.context.action,
  events: snap.context.events,
  disclosures: (snap.context.disclosures || []).map(
    ({ factId, speaker, listener, text }) => ({ factId, speaker, listener, text }),
  ),
  views: snap.context.entities.map(({ id, facts, desire }) => ({
    id,
    facts,
    desire,
  })),
});
const withoutOwnWant = (snap) => {
  const view = projection(snap);
  const want = wantOf(snap.world, CAST.player);
  return {
    ...view,
    views: view.views.map((v) =>
      v.id === CAST.player
        ? {
            id: v.id,
            facts: v.facts.filter(
              (f) => !want || !f.includes(nameOf(want.target)),
            ),
          }
        : v,
    ),
  };
};

const runs = { local: run("local"), shared: run("shared") };

describe.each(["local", "shared"])("voice truth in %s play", (mode) => {
  const snaps = runs[mode];
  const all = ["start", ...STEPS.map(([step]) => step)].map((s) => snaps[s]);

  it("states current custody from the committed holders at every step", () => {
    for (const snap of all) {
      for (const item of snap.context.outcome.items)
        expect(item.holder).toBe(snap.world.items[item.id].holder);
      for (const avatar of snap.context.outcome.avatars)
        expect(avatar.holding).toEqual(carried(snap.world, avatar.id));
      for (const id of avatars(snap)) {
        const [line, ...extra] = holding(snap, id);
        expect(extra).toEqual([]);
        for (const item of Object.values(ITEMS))
          expect(line.includes(nameOf(item)), `${snap.step} ${id} ${item}`).toBe(
            carried(snap.world, id).includes(item),
          );
      }
    }
  });

  it("moves custody only on a committed play, never on speech", () => {
    for (const snap of all.slice(1)) {
      const committed = snap.world.log
        .filter(
          (e) => e.turn === snap.world.turn && !e.generated && e.accepted !== false,
        )
        .flatMap((e) => [e.itemId, e.receiveId]);
      for (const [item, holder] of Object.entries(holders(snap.world)))
        if (holder !== snap.before.world.items[item].holder)
          expect(committed, `${snap.step} ${item}`).toContain(item);
      if (snap.spoken) {
        expect(holders(snap.spoken)).toEqual(holders(snap.world));
        expect(Object.keys(snap.spoken.knowledge.facts)).toEqual(
          Object.keys(snap.world.knowledge.facts),
        );
      }
    }
    for (const step of Object.keys(CLAIM)) {
      expect(snaps[step].context.speakers).toContain(CAST.near);
      expect(snaps[step].spoken.items[ITEMS.kept].holder).toBe(CAST.near);
    }
  });

  it.each(REFUSALS)("%s commits nothing for any speaker", (step) => {
    const snap = snaps[step];
    const { card } = snap.context.outcome;
    expect(card.accepted).toBe(false);
    expect(snap.entry.accepted).toBe(false);
    expect(REFUSAL_REASONS).toContain(snap.entry.reason);
    expect(holders(snap.world)).toEqual(holders(snap.before.world));
    expect(snap.world.knowledge.facts[`event:${snap.entry.seq}`]).toBeUndefined();
    for (const id of avatars(snap)) {
      if (entity(snap.before, id))
        expect(holding(snap, id)).toEqual(holding(snap.before, id));
      expect(facts(snap, id).filter((f) => SHAPE.exchange.test(f))).toEqual([]);
      expect(
        facts(snap, id).filter(
          (f) => provenance(f) && f.includes(snap.entry.text),
        ),
      ).toEqual([]);
    }
    for (const id of [CAST.player, card.target])
      expect(facts(snap, id)[0].match(SHAPE.refusal)?.[1]).toBe(
        snap.entry.reason,
      );
    const bystanders = avatars(snap).filter(
      (id) => ![CAST.player, card.target].includes(id),
    );
    for (const id of bystanders)
      expect(facts(snap, id).filter((f) => SHAPE.refusal.test(f))).toEqual([]);
    if (step === "refusedGive") expect(bystanders).toEqual([CAST.near]);
  });

  it("keeps a conditional offer apart from a transfer", () => {
    const snap = snaps.offer;
    const offers = facts(snap, CAST.near).filter((f) => SHAPE.offer.test(f));
    expect(
      offers.filter(
        (f) => f.includes(nameOf(ITEMS.offered)) && f.includes(nameOf(ITEMS.kept)),
      ).length,
    ).toBeGreaterThan(0);
    expect(snap.context.outcome.card).toMatchObject({
      kind: "talk",
      target: CAST.near,
      item: null,
      receive: null,
      accepted: null,
    });
    expect(holders(snap.world)).toEqual(holders(snap.before.world));
    expect(holders(snap.spoken)).toEqual(holders(snap.before.world));
    expect(snap.world.knowledge.facts).toEqual({});
    expect(snap.spoken.knowledge.facts).toEqual({});
    for (const id of avatars(snap)) {
      expect(holding(snap, id)).toEqual(holding(snap.before, id));
      expect(
        facts(snap, id).filter((f) => SHAPE.exchange.test(f) || provenance(f)),
      ).toEqual([]);
    }
    expect(facts(snap, CAST.player).filter((f) => SHAPE.offer.test(f))).toEqual([]);
  });

  it("tells a stated want from the rules-derived want", () => {
    for (const snap of all) {
      for (const id of avatars(snap)) {
        const want = wantOf(snap.world, id);
        const { desire } = entity(snap, id);
        const named = [...desire.items, desire.location, ...desire.avatars].filter(
          Boolean,
        );
        expect(named.filter((target) => target !== want?.target)).toEqual([]);
      }
    }
    const snap = snaps.offer;
    const want = wantOf(snap.world, CAST.near);
    expect(want).toMatchObject({ kind: "item", target: ITEMS.offered });
    expect(entity(snap, CAST.near).desire).toEqual({
      items: [want.target],
      location: null,
      avatars: [],
    });
    expect(facts(snap, CAST.near)[0]).toContain(nameOf(want.target));
    expect(SHAPE.offer.test(facts(snap, CAST.near)[0])).toBe(false);
    expect(entity(snap.before, CAST.near).desire.items).toEqual([]);
    expect(entity(snaps.refusedAsk, CAST.near).desire.items).toEqual([]);
    for (const step of ["told", "retold"]) {
      expect(wantOf(snaps[step].world, CAST.far)).toBeNull();
      expect(entity(snaps[step], CAST.far).desire).toEqual({
        items: [],
        location: null,
        avatars: [],
      });
    }
  });

  it("gives an accepted exchange to its witnesses as a committed outcome", () => {
    const snap = snaps.exchange;
    expect(snap.context.outcome.card).toMatchObject({
      kind: "trade",
      target: CAST.near,
      item: ITEMS.offered,
      receive: ITEMS.kept,
      accepted: true,
    });
    expect(snap.entry.accepted).toBe(true);
    expect(holders(snap.world)).toMatchObject({
      [ITEMS.offered]: CAST.near,
      [ITEMS.kept]: CAST.player,
    });
    const fact = eventFact(snap);
    expect(fact.text).toBe(snap.entry.text);
    expect(fact.source).toMatchObject({
      kind: "event",
      actorId: CAST.player,
      locationId: PLACES.away,
      witnesses: [CAST.near, CAST.player].sort(),
    });
    for (const [id, gained] of [
      [CAST.player, ITEMS.kept],
      [CAST.near, ITEMS.offered],
    ]) {
      expect(snap.world.knowledge.known[id][fact.id]).toMatchObject({
        kind: "witnessed",
        teller: null,
      });
      expect(SHAPE.exchange.test(facts(snap, id)[0])).toBe(true);
      expect(facts(snap, id)[0].endsWith(`${nameOf(gained)}.`)).toBe(true);
      const [line, ...extra] = recalls(snap, id, fact.text);
      expect(extra).toEqual([]);
      expect(SHAPE.witnessed.test(line)).toBe(true);
    }
    expect(snap.world.knowledge.known[CAST.far]).toBeUndefined();
    expect(entity(snap, CAST.far)).toBeUndefined();
    expect(recalls(snaps.away, CAST.near, fact.text).map(provenance)).toEqual([
      true,
    ]);
    expect(SHAPE.witnessed.test(recalls(snaps.away, CAST.near, fact.text)[0])).toBe(
      true,
    );
  });

  it("keeps an unseen event unknown until its words are heard", () => {
    const fact = eventFact(snaps.exchange);
    for (const step of ["back", "told"]) {
      expect(snaps[step].world.knowledge.known[CAST.far]).toBeUndefined();
      expect(recalls(snaps[step], CAST.far, fact.text)).toEqual([]);
      expect(facts(snaps[step], CAST.far).filter((f) => provenance(f))).toEqual(
        [],
      );
    }
    const told = snaps.told;
    expect(told.context.disclosures).toEqual([
      {
        factId: fact.id,
        speaker: CAST.player,
        listener: CAST.far,
        eventSeq: told.entry.seq,
        text: fact.text,
      },
    ]);
    expect(told.unheard.knowledge.known[CAST.far]).toBeUndefined();
    expect(told.unheard.knowledge.pending).toEqual(told.world.knowledge.pending);
    expect(told.spoken.knowledge.pending).toEqual([]);
  });

  it("marks a story heard secondhand as told by its teller, never witnessed", () => {
    const fact = eventFact(snaps.exchange);
    const heard = snaps.told.spoken.knowledge.known[CAST.far][fact.id];
    expect(heard).toMatchObject({
      kind: "heard",
      teller: CAST.player,
      learnedTurn: snaps.told.world.turn,
    });
    expect(fact.source.witnesses).not.toContain(CAST.far);
    for (const step of ["revisit", "retold", "later", "stale"]) {
      const snap = snaps[step];
      expect(snap.world.knowledge.known[CAST.far][fact.id]).toEqual(heard);
      expect(snap.world.knowledge.facts[fact.id].source).toEqual(fact.source);
      const [line, ...extra] = recalls(snap, CAST.far, fact.text);
      expect(extra, step).toEqual([]);
      expect(line.startsWith(toldBy(CAST.player)), step).toBe(true);
      expect(SHAPE.witnessed.test(line), step).toBe(false);
      expect(
        facts(snap, CAST.far).filter((f) => SHAPE.witnessed.test(f)),
      ).toEqual([]);
    }
  });

  it("does not turn an old account into present custody after a later transfer", () => {
    const first = eventFact(snaps.exchange);
    const later = eventFact(snaps.handBack);
    expect(snaps.handBack.context.outcome.card).toMatchObject({
      kind: "give",
      item: ITEMS.kept,
      target: CAST.near,
      accepted: true,
    });
    expect(later.source.witnesses).not.toContain(CAST.far);
    const stale = snaps.revisit;
    expect(stale.world.items[ITEMS.kept].holder).toBe(CAST.near);
    expect(
      stale.context.outcome.items.find((i) => i.id === ITEMS.kept).holder,
    ).toBe(CAST.near);
    expect(stale.world.knowledge.known[CAST.far][later.id]).toBeUndefined();
    expect(
      facts(stale, CAST.far).filter(
        (f) => !provenance(f) && f.includes(nameOf(ITEMS.kept)),
      ),
    ).toEqual([]);
    expect(snaps.retold.spoken.knowledge.known[CAST.far][later.id]).toMatchObject({
      kind: "heard",
      teller: CAST.player,
    });
    const view = facts(snaps.later, CAST.far);
    const newer = view.findIndex((f) => f.includes(later.text));
    const older = view.findIndex((f) => f.includes(first.text));
    expect(newer).toBeGreaterThanOrEqual(0);
    expect(older).toBeGreaterThan(newer);
    expect(view[newer].startsWith(toldBy(CAST.player))).toBe(true);
    expect(view[older].endsWith(first.text)).toBe(true);
    const aged = facts(snaps.stale, CAST.far);
    expect(aged.find((f) => f.includes(first.text)).endsWith(first.text)).toBe(
      false,
    );
    expect(aged.find((f) => f.includes(later.text)).endsWith(later.text)).toBe(
      true,
    );
  });

  it("records only accepted plays as events anyone can recall", () => {
    const { world } = snaps.end;
    const sources = Object.values(world.knowledge.facts).map((fact) =>
      world.log.find((e) => e.seq === fact.source.eventSeq),
    );
    expect(sources.length).toBeGreaterThanOrEqual(2);
    for (const entry of sources) {
      expect(entry.generated).toBeFalsy();
      expect(entry.accepted).not.toBe(false);
    }
    for (const [actor, known] of Object.entries(world.knowledge.known))
      for (const [id, memory] of Object.entries(known)) {
        const { witnesses } = world.knowledge.facts[id].source;
        expect(witnesses.includes(actor), `${actor} ${id}`).toBe(
          memory.kind === "witnessed",
        );
        expect(memory.teller === null).toBe(memory.kind === "witnessed");
      }
  });

  it("keeps provenance through save and reload", () => {
    const table = TABLES[mode];
    const { stored } = snaps.end;
    const again = table.reload(stored);
    expect(table.read(again).knowledge).toEqual(table.read(stored).knowledge);
    expect(projection({ context: table.context(again, null) })).toEqual(
      projection({ context: table.context(stored, null) }),
    );
  });
});

describe("voice truth across local and shared play", () => {
  it.each(["start", ...STEPS.map(([step]) => step)])(
    "gives each speaker the same view at %s",
    (step) => {
      expect(withoutOwnWant(runs.shared[step])).toEqual(
        withoutOwnWant(runs.local[step]),
      );
      expect(runs.shared[step].world.knowledge).toEqual(
        runs.local[step].world.knowledge,
      );
    },
  );
});
