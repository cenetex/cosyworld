import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  installQuestCollection,
  hand,
  at,
  hold,
  withAvatars,
} from "../v2/card-game/quests.mjs";
import { lifeOf } from "../v2/card-game/life.mjs";
import {
  addQuestRecord,
  collectionCards,
  focusQuest,
  registerPersonalQuest,
} from "../v2/card-game/shared-quests.mjs";
import { recordQuestCompletion } from "../v2/card-game/quest-completions.mjs";
import {
  QUEST_TALK_LIMIT,
  questLeads,
  questTalkFacts,
} from "../v2/card-game/quest-talk.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";

const fresh = () => enableMotives(createWorld(), { personalQuests: true });
function deck(world, actor, programs) {
  installQuestCollection(world, actor);
  const collection = lifeOf(world, actor).collection;
  for (const q of collectionCards(world, actor))
    delete world.quests.records[q.key];
  delete world.quests.focus[actor];
  collection.cards = programs.map(
    (program, serial) =>
      registerPersonalQuest(world, actor, {
        key: `${actor}:quest:${serial}`,
        program,
        step: 0,
        origin: null,
        createdTurn: world.turn,
        completedTurn: null,
      }).key,
  );
  collection.next = programs.length;
  collection.active = collection.cards[0];
  focusQuest(world, actor, collection.active);
  return collection;
}
const valeFacts = (world) =>
  narrativeContext(world).entities.find((e) => e.id === "vale").facts;

describe("quests in Talk context", () => {
  it("leads with the saved focus, then follows the quest Vale last advanced", () => {
    const world = fresh();
    deck(world, "vale", [
      { id: "first", name: "The first wish", steps: [hand(at("pond"))] },
      { id: "second", name: "The second wish", steps: [hand(at("attic"))] },
    ]);
    expect(questTalkFacts(world, "vale")[0]).toMatch(
      /^What I want most now: The first wish\./u,
    );
    world.turn = 3;
    world.quests.records["vale:quest:1"].lastProgressTurn = 3;
    const facts = questTalkFacts(world, "vale");
    expect(facts[0]).toMatch(/^What I want most now: The second wish\./u);
    expect(facts).toContain("I also want to pursue The first wish.");
    // Narration never moves the rules' saved focus.
    expect(world.quests.focus.vale).toBe("vale:quest:0");
  });

  it("follows a quest Vale was told about through Talk", () => {
    const world = fresh();
    deck(world, "vale", [
      { id: "first", name: "The first wish", steps: [hand(at("pond"))] },
      {
        id: "news",
        name: "Word from the shore",
        steps: [
          { ...hand(at("pond")), conditions: [{ kind: "knows", topic: "t" }] },
        ],
      },
    ]);
    world.turn = 4;
    world.knowledge = {
      ...(world.knowledge || {}),
      known: {
        ...(world.knowledge?.known || {}),
        vale: {
          t: { kind: "told", teller: "moth", eventSeq: 1, learnedTurn: 4 },
        },
      },
    };
    expect(questTalkFacts(world, "vale")[0]).toMatch(
      /^What I want most now: Word from the shore\./u,
    );
  });

  it("tells people here about a help card without joining it", () => {
    const singer = "greek-rhapsode";
    let s = fresh();
    s.sharedVersion = 1;
    s.controlledActors = ["vale"];
    s.presentActors = ["vale"];
    s.actors.vale.place = "theatre";
    s.actors[singer].place = "theatre";
    s.items.mask.holder = "theatre";
    const q = addQuestRecord(s, {
      holder: { kind: "place", id: "pond" },
      program: {
        id: "shore-deed",
        name: "A deed by the shore",
        steps: [{ items: [], avatars: [], location: "pond" }],
      },
    });
    q.completedTurn = s.turn;
    q.step = 1;
    recordQuestCompletion(s, q, { actorId: "keeper", locationId: "pond" });
    s = play(
      s,
      legalActions(s).find((a) => a.kind === "wait"),
    ).state;
    const help = s.quests.records[s.roamingQuests[singer].blocked.questKey];
    expect(help.participants).not.toContain("vale");
    const before = encodeSave(s);
    const facts = valeFacts(s);
    expect(encodeSave(s)).toBe(before);
    expect(facts.join(" ")).toContain(
      `Help needed here: ${help.program.name}.`,
    );
    expect(help.participants).not.toContain("vale");
  });

  it("names an open shared story held at this place", () => {
    const world = fresh();
    const here = world.actors.vale.place;
    addQuestRecord(world, {
      holder: { kind: "place", id: here },
      program: {
        id: "lantern-song",
        name: "A song for the lanterns",
        purpose: "The station wants a song.",
        steps: [{ items: [], avatars: [], location: here }],
      },
    });
    expect(questTalkFacts(world, "vale").join(" ")).toContain(
      "Open story here: A song for the lanterns. The station wants a song.",
    );
  });

  it("stays within the dialogue fact bounds", () => {
    const world = fresh();
    const here = world.actors.vale.place;
    deck(world, "vale", [
      { id: "a", name: "x".repeat(300), steps: [hand(at("pond"))] },
      { id: "b", name: "y".repeat(300), steps: [hand(at("attic"))] },
    ]);
    for (let i = 0; i < 4; i++)
      addQuestRecord(world, {
        holder: { kind: "place", id: here },
        program: {
          id: `open-${i}`,
          name: `Open ${i} `.repeat(30),
          steps: [{ items: [], avatars: [], location: here }],
        },
      });
    const facts = questTalkFacts(world, "vale");
    expect(facts.length).toBeLessThanOrEqual(QUEST_TALK_LIMIT);
    for (const fact of facts) expect(fact.length).toBeLessThanOrEqual(240);
    for (const entity of narrativeContext(world).entities)
      expect(entity.facts.length).toBeLessThanOrEqual(16);
  });

  it("lists a learned fact an open quest asks about before newer news", () => {
    const world = fresh();
    deck(world, "vale", [
      {
        id: "news",
        name: "Word from the shore",
        steps: [
          {
            ...hand(at("pond")),
            conditions: [{ kind: "knows", topic: "old" }],
          },
        ],
      },
    ]);
    const fact = (id, turn, text) => ({
      id,
      text,
      source: { kind: "event", turn, eventSeq: turn },
    });
    world.knowledge = {
      version: 1,
      facts: {
        old: fact("old", 1, "The ferry left before dawn."),
        a: fact("a", 5, "Pip lit a lamp."),
        b: fact("b", 6, "The keeper rang the bell."),
      },
      known: {
        vale: Object.fromEntries(
          ["old", "a", "b"].map((id, i) => [
            id,
            { kind: "witnessed", teller: null, eventSeq: i, learnedTurn: i },
          ]),
        ),
      },
      pending: [],
    };
    const facts = valeFacts(world).join(" ");
    expect(facts).toContain("The ferry left before dawn.");
    expect(facts).toContain("The keeper rang the bell.");
    expect(facts).not.toContain("Pip lit a lamp.");
  });

  it("lets a resident point the way to another person's quest step", () => {
    const world = fresh();
    deck(world, "vale", [
      {
        id: "bell",
        name: "A bell for the pond",
        steps: [hand(hold("bell"), at("pond"), withAvatars("moth"))],
      },
    ]);
    world.items.bell.holder = "moth";
    const before = encodeSave(world);
    const leads = questLeads(world, "moth");
    expect(leads[0]).toBe(
      "Vale is pursuing A bell for the pond. It needs me there. I hold the Bell it needs.",
    );
    expect(questTalkFacts(world, "moth")[1]).toBe(leads.join(" "));
    // The keeper is not part of Vale's step, so the keeper names no lead for it.
    expect(
      questLeads(world, "keeper").some((line) => line.startsWith("Vale")),
    ).toBe(false);
    expect(encodeSave(world)).toBe(before);
  });
});
