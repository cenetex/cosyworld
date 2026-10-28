import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { questHistoryCards } from "../v2/card-game/quest-cards.mjs";
import {
  questCarried,
  questHolderActor,
} from "../v2/card-game/quest-hands.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { helenEnding } from "./helpers/book-iv.mjs";
import { ajaxAccount } from "./helpers/greek-ajax.mjs";
import { aulisAccount } from "./helpers/greek-book-three.mjs";
import { danaidReady, playDanaid } from "./helpers/greek-danaid.mjs";

const GREEK = "greek-drama";
const keyFor = (name) => `${GREEK}:story-quest-greek-${name}-return`;

function danaidAccount() {
  let world = danaidReady();
  for (const [kind, fields] of [
    ["choose", { choiceId: "greek-danaid-choose-household" }],
    ["choose", { choiceId: "greek-danaid-agree-journey" }],
    ["take", { item: "greek-danaid-host-pledge" }],
    ["take", { item: "greek-danaid-provisions" }],
    ["give", { item: "greek-danaid-provisions", target: "greek-danaid-nera" }],
    [
      "accompany",
      { target: "greek-danaid-nera", destination: "greek-danaid-refuge-court" },
    ],
    ["choose", { choiceId: "greek-danaid-receive-household" }],
  ])
    world = playDanaid(world, kind, fields);
  return world;
}

const cases = [
  {
    name: "Book IV Helen",
    story: "book-iv-helen",
    build: () => helenEnding("hearing"),
    item: "greek-book-iv-helen-account",
    speaker: "greek-book-iv-helen-theoclymenus",
    topics: ["greek-book-iv-helen-finish-hearing-words"],
    prepare: [["take", { item: "greek-egypt-testimony" }]],
    route: [
      "greek-egypt-tomb",
      "greek-book-iv-helen-landing",
      "greek-ship",
      "greek-harbor",
      "greek-courtyard",
    ],
    ending: "greek-book-iv-helen-finish-hearing",
    returned: "greek-book-iv-helen-return-hearing",
  },
  {
    name: "Book II Danaid",
    story: "danaid",
    build: danaidAccount,
    item: "greek-danaid-host-pledge",
    // Nera signs the carried pledge on arrival. Its return reads that document.
    topics: [],
    route: [
      "greek-argos-sanctuary",
      "greek-argolid-road",
      "greek-harbor",
      "greek-courtyard",
    ],
    ending: "greek-danaid-receive-household",
    returned: "greek-danaid-return-household",
  },
  {
    name: "Book III Aulis",
    story: "aulis",
    build: () => aulisAccount("rescue"),
    item: "greek-aulis-departure-record",
    speaker: "greek-aulis-clytemnestra",
    topics: ["greek-aulis-purpose", "greek-aulis-account-rescue"],
    route: ["greek-aulis", "greek-ship", "greek-harbor", "greek-courtyard"],
    ending: "greek-aulis-complete-rescue",
    returned: "greek-aulis-return-rescue",
  },
  {
    name: "Ajax",
    story: "ajax",
    build: () => ajaxAccount("public"),
    item: "greek-ajax-plea",
    speaker: "greek-ajax-teucer",
    topics: ["greek-ajax-plea", "greek-ajax-account-public"],
    route: [
      "greek-ajax-landing",
      "greek-ship",
      "greek-harbor",
      "greek-courtyard",
    ],
    ending: "greek-ajax-bury-public",
    returned: "greek-ajax-return-public",
  },
];

function sharedScene(original) {
  const created = dispatchShared({ op: "create", save: encodeSave(original) });
  expect(created.ok, created.error).toBe(true);
  let world = created.world;
  world.actors.mara.place = world.actors.vale.place;
  const initial = structuredClone(world),
    journal = [];
  const request = (op, actor, fields = {}) => {
    const command = {
      op,
      actor,
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
      ...fields,
    };
    const result = dispatchShared({ ...command, world });
    expect(result.ok, result.error).toBe(true);
    if (op !== "view") world = result.world;
    if (op === "play" || op === "speech")
      journal.push(structuredClone(command));
    return result;
  };
  const act = (actor, kind, fields = {}) => {
    const action = request("view", actor).actions.find(
      (a) =>
        a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
    );
    expect(action, `${actor} ${kind} ${JSON.stringify(fields)}`).toBeTruthy();
    return request("play", actor, { action, revision: world.revision });
  };
  return {
    get world() {
      return world;
    },
    act,
    request,
    reload() {
      const loaded = decodeSave(encodeSave(world));
      expect(loaded).toEqual(world);
      world = loaded;
    },
    replay() {
      let replay = structuredClone(initial);
      for (const command of journal) {
        const result = dispatchShared({ ...command, world: replay });
        expect(result.ok, result.error).toBe(true);
        replay = result.world;
      }
      expect(replay).toEqual(world);
    },
  };
}

function pendingCard(scene, spec) {
  const key = keyFor(spec.story);
  const record = scene.world.quests.records[key];
  expect(record.holder).toEqual({ kind: "item", id: spec.item });
  expect(record.completedTurn).toBeNull();
  expect(questHolderActor(scene.world, record)).toBe("mara");
  expect(
    questHistoryCards(scene.world, "mara").find((card) => card.key === key),
  ).toMatchObject({ completedTurn: null });
  expect(questCarried(scene.world, "mara", key)).toBe(true);
}

function expectEarlierVerses(world, original) {
  for (const [id, verse] of Object.entries(original.recitals)) {
    expect(world.packs[GREEK].receipts[id]).toBe(original.receipts[id]);
    expect(world.packs[GREEK].recitals[id]).toMatchObject({
      actor: verse.actor,
      ...(verse.visit === null ? {} : { visit: verse.visit }),
    });
  }
}

describe(
  "Greek return cards follow their second carrier",
  { timeout: 60000 },
  () => {
    it.each(cases)(
      "keeps the $name card and original authors through handover",
      (spec) => {
        const scene = sharedScene(spec.build());
        const key = keyFor(spec.story);
        const original = structuredClone(scene.world.packs[GREEK]);
        const completed = Object.fromEntries(
          Object.entries(scene.world.quests.records)
            .filter(([, q]) => q.mode === "story" && q.completedTurn !== null)
            .map(([id, q]) => [id, structuredClone(q.completion)]),
        );
        expect(original.recitals[spec.ending].actor).toBe("vale");
        for (const [kind, fields] of spec.prepare || [])
          scene.act("vale", kind, fields);
        // Make room in Mara's two-card hand through ordinary choices.
        for (const action of scene
          .request("view", "mara")
          .actions.filter((a) => a.kind === "drop-quest"))
          scene.request("play", "mara", { action });
        expect(
          questHistoryCards(scene.world, "mara").some(
            (card) => card.key === key,
          ),
        ).toBe(false);
        scene.act("vale", "give", { item: spec.item, target: "mara" });
        pendingCard(scene, spec);
        scene.reload();
        pendingCard(scene, spec);
        if (spec.topics.length) {
          expect(knowsFact(scene.world, "mara", spec.topics.at(-1))).toBe(
            false,
          );
          for (const topic of spec.topics) {
            const { context } = scene.act("mara", "talk", {
              target: spec.speaker,
            });
            expect(context.disclosures[0].factId).toBe(topic);
            pendingCard(scene, spec);
            scene.request("speech", "mara", {
              room: scene.world.actors.mara.place,
              disclosures: context.disclosures,
              lines: [
                { actorId: "mara", text: "Please read the account for Dione." },
                { actorId: spec.speaker, text: context.disclosures[0].text },
              ],
            });
          }
          expect(knowsFact(scene.world, "mara", spec.topics.at(-1))).toBe(true);
          pendingCard(scene, spec);
          scene.reload();
        }
        for (const [id, receipt] of Object.entries(original.receipts))
          expect(scene.world.packs[GREEK].receipts[id]).toBe(receipt);
        expect(Object.keys(scene.world.packs[GREEK].recitals)).toEqual(
          Object.keys(original.recitals),
        );
        expectEarlierVerses(scene.world, original);
        for (const [id, completion] of Object.entries(completed))
          expect(scene.world.quests.records[id].completion).toEqual(completion);
        for (const target of spec.route) {
          if (target === "greek-ship")
            for (
              let i = 0;
              i < 32 &&
              !scene
                .request("view", "mara")
                .actions.some((a) => a.kind === "move" && a.target === target);
              i++
            )
              scene.act("mara", "wait");
          scene.act("mara", "move", { target });
        }
        scene.act("mara", "choose", { choiceId: spec.returned });
        expect(scene.world.quests.records[key].completion.actorId).toBe("mara");
        expect(scene.world.packs[GREEK].recitals[spec.returned].actor).toBe(
          "mara",
        );
        expectEarlierVerses(scene.world, original);
        for (const [id, completion] of Object.entries(completed))
          expect(scene.world.quests.records[id].completion).toEqual(completion);
        scene.reload();
        scene.replay();
      },
    );
  },
);
