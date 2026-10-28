import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  packDefinition,
  entityActive,
} from "../v2/card-game/pack-registry.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { questRecord } from "../v2/card-game/shared-quests.mjs";
import { questHistoryCards } from "../v2/card-game/quest-cards.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { bookReplay } from "./fixtures/card-book-one-replay.mjs";
import { releasedCardEngine } from "./helpers/released-card-engine.mjs";
import {
  bookStart,
  bookJourney,
  bookEndings,
  bookAccounts,
  bookAct,
  bookWalk,
  bookAction,
  bookState,
} from "./helpers/greek-book-one.mjs";

const pack = packDefinition("greek-drama");
const reload = (w) => decodeSave(encodeSave(w));
const cases = Object.entries(bookEndings).flatMap(([part, ends]) =>
  ends.map((ending) => [part, ending]),
);
const story = (w, part, beat) =>
  questRecord(w, `greek-drama:story-quest-greek-${part}-${beat}`);
const offered = (w, id, actor = "vale") =>
  !!bookAction(w, "choose", { choiceId: id }, actor);
const added = (id) =>
  /^greek-(seven|phoenician|tyrannus|bacchae|book-one)-/.test(id);
const beats = {
  seven: ["shields", "shelter", "remembrance", "return"],
  phoenician: ["truce", "care", "remembrance", "return"],
  tyrannus: ["care", "witnesses", "reading", "return"],
  bacchae: ["account", "robe", "response", "return"],
};

describe("Book I present care", () => {
  it("keeps the four plays in a shared catalog with physical endings and short source facts", () => {
    expect(pack.revision).toBe(8);
    expect(pack.choices.filter((c) => added(c.id))).toHaveLength(37);
    expect(pack.topics.filter((c) => added(c.id))).toHaveLength(23);
    expect(pack.storyQuests.filter((q) => q.group === "book-one")).toHaveLength(
      16,
    );
    expect(pack.recital.verses.filter((v) => added(v.choice))).toHaveLength(28);
    expect(Object.keys(pack.avatars)).toHaveLength(35);
    expect(Object.keys(pack.items)).toHaveLength(40);
    expect(Object.keys(pack.places)).toHaveLength(63);
    for (const t of pack.topics.filter((c) => added(c.id))) {
      expect(t.text.length).toBeLessThanOrEqual(180);
      expect(t.choiceId).toBeUndefined();
    }
    for (const c of pack.choices.filter((c) => added(c.id))) {
      expect(
        c.textTemplate.replace("{actor}", "Alexandria").length,
      ).toBeLessThanOrEqual(180);
      if (!c.id.startsWith("greek-book-one"))
        expect(c.requires.some((r) => r.kind === "holding")).toBe(true);
    }
    for (const work of [
      "aeschylus-seven-against-thebes",
      "euripides-phoenician-women",
      "sophocles-oedipus-tyrannus",
      "euripides-bacchae",
    ]) {
      const w = pack.works.find((w) => w.id === work);
      expect(w.status).toBe("branching-episode");
      expect(
        w.hookChoiceIds.every((id) => pack.choices.some((c) => c.id === id)),
      ).toBe(true);
    }
  });

  it.each(["burial", "concession", "refusal", "exposure"])(
    "opens after the %s response returns to Dione",
    (branch) => {
      const w = bookStart(branch);
      expect(bookState(w).flags["greek-book-one-open"]).toBe(true);
      expect(entityActive(w, "greek-melea")).toBe(true);
      expect(entityActive(w, "greek-melitta")).toBe(true);
      expect(offered(w, `greek-book-one-invitation-${branch}`)).toBe(false);
      expect(reload(w)).toEqual(w);
    },
  );

  it.each(cases)(
    "finishes %s / %s through carried deeds and ordered Talk",
    (part, ending) => {
      const { world, before, trace } = bookJourney(part, ending, { reload });
      expect(bookState(world).choices[`greek-${part}-ending`]).toBe(ending);
      expect(bookState(world).choices[`greek-${part}-return`]).toBe(ending);
      expect(world.items[`greek-${part}-${bookAccounts[part]}`].holder).toBe(
        "greek-courtyard",
      );
      for (const beat of beats[part])
        expect(story(world, part, beat).completion).toMatchObject({
          actorId: "vale",
          participants: ["vale"],
        });
      expect(knowsFact(world, "vale", `greek-${part}-account-${ending}`)).toBe(
        true,
      );
      const verses = recitalPoem(world, pack).stanzas.filter((v) =>
        v.id.startsWith(`greek-${part}-`),
      );
      expect(verses).toHaveLength(4);
      expect(verses.at(-1).id).toBe(`greek-${part}-return-${ending}`);
      expect(verses.map((v) => v.turn)).toEqual(
        verses.map((v) => v.turn).sort((a, b) => a - b),
      );
      expect(offered(world, `greek-${part}-return-${ending}`)).toBe(false);
      expect(recitalPoem(bookAct(world, "wait"), pack)).toEqual(
        recitalPoem(world, pack),
      );
      for (const [id, state] of Object.entries(before)) {
        const choice = pack.choices.find((c) => c.id === id),
          action = bookAction(state, "choose", { choiceId: id });
        for (const requirement of choice.requires.filter(
          (r) => r.kind === "holding",
        )) {
          const dropped = bookAct(state, "drop", {
            item: requirement.item,
            target: state.actors.vale.place,
          });
          expect(
            offered(dropped, id),
            `${id} requires ${requirement.item}`,
          ).toBe(false);
          expect(play(dropped, action, dropped.revision).ok).toBe(false);
        }
      }
      expect(
        trace
          .filter((t) => t.context)
          .every((t) => t.context.disclosures.length > 0),
      ).toBe(true);
    },
  );

  it("keeps the family-first reading pending until the same account reaches the well", () => {
    const { after, before } = bookJourney("tyrannus", "household-first");
    const family = reload(after["greek-tyrannus-read-family"]);
    expect(story(family, "tyrannus", "reading").completedTurn).toBeNull();
    expect(bookState(family).choices["greek-tyrannus-ending"]).toBeUndefined();
    expect(
      before["greek-tyrannus-household-first"].items["greek-tyrannus-account"]
        .holder,
    ).toBe("vale");
    expect(
      story(after["greek-tyrannus-household-first"], "tyrannus", "reading")
        .completion.actorId,
    ).toBe("vale");
  });

  it("requires both witness checks and both local acceptances", () => {
    const inquiry = bookJourney("tyrannus", "attributed-witnesses");
    let w = inquiry.after["greek-tyrannus-melea-approves"];
    w = bookWalk(
      bookAct(w, "take", { item: "greek-tyrannus-account" }),
      "greek-well",
    );
    expect(offered(w, "greek-tyrannus-attributed-witnesses")).toBe(false);
    for (const reverseAgreement of [false, true]) {
      const { before, after } = bookJourney(
        "bacchae",
        "local-gathering-agreement",
        { reverseAgreement },
      );
      const first = reverseAgreement ? "melitta" : "elder";
      const pending = after[`greek-bacchae-${first}-accepts`];
      expect(story(pending, "bacchae", "response").completedTurn).toBeNull();
      w = bookWalk(
        bookAct(pending, "take", { item: "greek-bacchae-terms" }),
        "greek-cithaeron",
      );
      expect(offered(w, "greek-bacchae-local-gathering-agreement")).toBe(false);
      expect(
        offered(
          before["greek-bacchae-local-gathering-agreement"],
          "greek-bacchae-local-gathering-agreement",
        ),
      ).toBe(true);
    }
  });

  it("learns the source only when its reserved line is published", () => {
    const step = bookJourney("seven", "two-name-vigil").trace.find(
      (t) => t.context?.disclosures[0]?.factId === "greek-seven-shields",
    );
    let w = step.pending;
    const context = narrativeContext(w, step.action),
      disclosure = context.disclosures[0];
    expect(disclosure.factId).toBe("greek-seven-shields");
    const response = (text) => ({
      revision: context.revision,
      model: "fixture",
      entries: context.entities.map(({ id }) => ({
        id,
        text: id === disclosure.speaker ? text : "I am listening.",
      })),
    });
    expect(
      knowsFact(
        applyGeneratedText(w, context, response("The sun is warm.")),
        "vale",
        disclosure.factId,
      ),
    ).toBe(false);
    w = applyGeneratedText(reload(w), context, response(disclosure.text));
    expect(knowsFact(w, "vale", disclosure.factId)).toBe(true);
    expect(knowsFact(w, "vale", "greek-seven-inner-road")).toBe(false);
    expect(
      bookState(w).receipts["greek-seven-set-shield-record"],
    ).toBeUndefined();
  });
});

describe("Book I shared learning and history", () => {
  it.each(["seven", "tyrannus", "bacchae"])(
    "keeps %s gossip and deeds exact when the host reorders JSON keys",
    (part) => {
      const sorted = (value) =>
        JSON.parse(
          JSON.stringify(value, (_, v) =>
            v && typeof v === "object" && !Array.isArray(v)
              ? Object.fromEntries(
                  Object.keys(v)
                    .sort()
                    .map((key) => [key, v[key]]),
                )
              : v,
          ),
        );
      const fixture = bookReplay(part);
      let world = sorted(JSON.parse(fixture.save));
      for (const command of fixture.commands) {
        const result = dispatchShared(
          sorted({
            ...command,
            world,
            claimed: fixture.claimed,
            present: fixture.claimed,
          }),
        );
        expect(result.ok, result.error).toBe(true);
        world = sorted(result.world);
      }
      expect(world).toEqual(fixture.expected);
    },
  );

  it("credits the first meeting after the invitation to the visiting player", () => {
    let world = dispatchShared({
      op: "create",
      save: encodeSave(bookStart()),
    }).world;
    world.actors.mara.place = "greek-well";
    const fields = {
      world,
      actor: "mara",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    };
    const action = dispatchShared({ op: "view", ...fields }).actions.find(
      (a) => a.kind === "move" && a.target === "greek-palace",
    );
    const result = dispatchShared({ op: "play", ...fields, action });
    expect(result.ok, result.error).toBe(true);
    world = result.world;
    for (const [part, beat] of [
      ["phoenician", "truce"],
      ["tyrannus", "care"],
    ]) {
      expect(story(world, part, beat).createdTurn).toBe(world.turn);
      expect(story(world, part, beat).participants).toEqual(["mara"]);
    }
    expect(reload(world)).toEqual(world);
  });

  it("preserves every earlier action, source topic, story and earned verse", () => {
    const oldPack = releasedCardEngine(20).packs.find(
      (p) => p.id === "greek-drama",
    );
    for (const key of ["choices", "topics", "storyQuests"])
      for (const entry of oldPack[key])
        expect(
          pack[key].find((e) => (e.key || e.id) === (entry.key || entry.id)),
        ).toEqual(entry);
    for (const verse of oldPack.recital.verses)
      expect(
        pack.recital.verses.find((v) => v.choice === verse.choice),
      ).toEqual(verse);
  });

  it("lets Mara learn Vale's finished deed and carry its account home under her own name", () => {
    const original = bookJourney("seven", "two-name-vigil", {
      returnHome: false,
    }).world;
    let world = dispatchShared({
      op: "create",
      save: encodeSave(original),
    }).world;
    world.actors.mara.place = "greek-gate";
    const claimed = ["vale", "mara"];
    const request = (op, actor, fields = {}) => {
      const result = dispatchShared({
        op,
        world,
        actor,
        claimed,
        present: claimed,
        ...fields,
      });
      expect(result.ok, result.error).toBe(true);
      world = result.world;
      return result;
    };
    const act = (actor, kind, fields) => {
      const action = request("view", actor).actions.find(
        (a) =>
          a.kind === kind &&
          Object.entries(fields).every(([k, v]) => a[k] === v),
      );
      expect(action, `${actor} ${kind}`).toBeTruthy();
      return request("play", actor, { action });
    };
    act("mara", "take", { item: "greek-seven-shield-tablet" });
    expect(
      questHistoryCards(world, "mara").some(
        (q) => q.key === "greek-drama:story-quest-greek-seven-return",
      ),
    ).toBe(true);
    act("mara", "move", { target: "greek-courtyard" });
    expect(offered(world, "greek-seven-return-two-name-vigil", "mara")).toBe(
      false,
    );
    act("mara", "move", { target: "greek-gate" });
    for (
      let i = 0;
      i < 12 && !knowsFact(world, "mara", "greek-seven-account-two-name-vigil");
      i++
    ) {
      const { context } = act("mara", "talk", { target: "greek-guard" });
      request("speech", "mara", {
        room: "greek-gate",
        disclosures: context.disclosures,
        lines: [
          { actorId: "mara", text: "Tell me the account for Dione." },
          { actorId: "greek-guard", text: context.disclosures[0].text },
        ],
      });
    }
    expect(knowsFact(world, "mara", "greek-seven-account-two-name-vigil")).toBe(
      true,
    );
    act("mara", "move", { target: "greek-courtyard" });
    act("mara", "drop", {
      item: "greek-seven-shield-tablet",
      target: "greek-courtyard",
    });
    expect(offered(world, "greek-seven-return-two-name-vigil", "mara")).toBe(
      false,
    );
    act("mara", "take", { item: "greek-seven-shield-tablet" });
    act("mara", "choose", { choiceId: "greek-seven-return-two-name-vigil" });
    expect(story(world, "seven", "return").completion.actorId).toBe("mara");
    expect(story(world, "seven", "remembrance").completion.actorId).toBe(
      "vale",
    );
    expect(reload(world).knowledge).toEqual(world.knowledge);
  });

  it("upgrades a rules-20 saved deed with its facts, authors, objects and poem intact", () => {
    const old = releasedCardEngine(20);
    let before = old.dispatch({ op: "create" }).world;
    delete before.opening;
    before.actors.vale.place = "greek-courtyard";
    before.crossings["pond-greek-harbor"].discovered = true;
    before.items["greek-water-jar"].holder = "vale";
    const fields = { actor: "vale", claimed: ["vale"], present: ["vale"] };
    const action = old
      .dispatch({ op: "view", world: before, ...fields })
      .actions.find((a) => a.choiceId === "greek-return-water-jar");
    before = old.dispatch({
      op: "play",
      world: before,
      action,
      ...fields,
    }).world;
    const after = decodeSave(JSON.stringify(before));
    expect(bookState(after).revision).toBe(8);
    for (const key of ["receipts", "recitals", "choices", "flags"])
      expect(bookState(after)[key]).toEqual(bookState(before)[key]);
    for (const key of ["log", "knowledge"])
      expect(after[key]).toEqual(before[key]);
    expect(after.quests).toEqual({
      ...before.quests,
      hands: { ...before.quests.hands, "greek-melea": [], "greek-melitta": [] },
    });
    for (const [id, item] of Object.entries(before.items))
      expect(after.items[id]).toEqual(item);
    expect(recitalPoem(after, pack)).toEqual(
      old.poem(
        before,
        old.packs.find((p) => p.id === "greek-drama"),
      ),
    );
    for (const id of ["greek-melea", "greek-melitta"]) {
      expect(after.actors[id]).toBeTruthy();
      expect(after.memories[id]).toBeTruthy();
      expect(after.actors.vale.trust[id]).toBe(0);
      expect(entityActive(after, id)).toBe(false);
    }
    expect(reload(after)).toEqual(after);
  });

  it("replays ordered dialogue and deeds through the bundled shared rules", () => {
    const engine = releasedCardEngine(21),
      start = bookStart();
    const { trace } = bookJourney("tyrannus", "attributed-witnesses", {
      world: start,
    });
    const initial = dispatchShared({
      op: "create",
      save: encodeSave(start),
    }).world;
    let world = initial;
    const journal = [],
      fields = { actor: "vale", claimed: ["vale"], present: ["vale"] };
    const run = (request) => {
      const result = dispatchShared({ ...request, world, ...fields });
      expect(result.ok, result.error).toBe(true);
      expect(engine.dispatch({ ...request, world, ...fields })).toEqual(result);
      world = result.world;
      journal.push(request);
      return result;
    };
    for (const step of trace) {
      const result = run({ op: "play", action: step.action });
      if (step.context)
        run({
          op: "speech",
          room: world.actors.vale.place,
          disclosures: result.context.disclosures,
          lines: [
            { actorId: "vale", text: "I am listening to the account." },
            ...result.context.disclosures.map((d) => ({
              actorId: d.speaker,
              text: d.text,
            })),
          ],
        });
    }
    let replay = initial;
    for (const request of JSON.parse(JSON.stringify(journal)))
      replay = engine.dispatch({ ...request, world: replay, ...fields }).world;
    expect(replay).toEqual(world);
    expect(story(world, "tyrannus", "return").completion.actorId).toBe("vale");
    expect(reload(world)).toEqual(world);
  });
});
