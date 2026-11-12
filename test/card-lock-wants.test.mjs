import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import { createWorld } from "../v2/card-game/world.mjs";
import { goalsFrom, MOST_GOALS } from "../v2/card-game/world/lock-goals.mjs";
import {
  SEEK,
  UNKNOWN,
  joinWants,
  wantWords,
} from "../v2/card-game/world/want-words.mjs";
import { boxDefs, goalsFor } from "../v2/card-game/world/boxes.mjs";
import { lockWords } from "../v2/card-game/cards.mjs";
import { questCaption } from "../v2/card-game/quest-card.mjs";
import { people, places, things } from "../v2/card-game/world/catalog.mjs";
import { questsOf } from "../v2/card-game/want.mjs";
import { journeyWorlds } from "./helpers/journey.mjs";
import { questCards } from "./journeys/quest-cards.mjs";

// Lock and quest wording (rules 133): one wording of a want, from structure,
// screened by what the traveler has discovered. The synthetic world below uses
// made-up ids, so none of this depends on story prose.
const CARDS = {
  pip: { kind: "person", name: "Pip" },
  ada: { kind: "person", name: "Ada" },
  lamp: { kind: "item", name: "Lamp" },
  jar: { kind: "item", name: "Jar" },
  tea: { kind: "item", name: "Tea", drink: true },
  coat: { kind: "item", name: "Coat" },
  hut: { kind: "place", name: "Hut" },
  bay: { kind: "place", name: "Bay" },
};
const cards = {
  name: (id) => CARDS[id].name,
  kind: (id) => CARDS[id].kind,
  drink: (id) => Boolean(CARDS[id].drink),
};
const all = () => true;
const none = () => false;
const say = (want, known = all, options = {}) =>
  wantWords(want, known, { cards, ...options });

describe("one wording of a want", () => {
  const shapes = [
    [{ kind: "item", target: "lamp" }, "hold Lamp"],
    [{ kind: "item", target: "lamp", lit: true }, "hold the lit Lamp"],
    [{ kind: "item", target: "lamp", lit: false }, "hold the dark Lamp"],
    [{ kind: "person", target: "pip" }, "talk with Pip"],
    [{ kind: "place", target: "hut" }, "go to Hut"],
    [
      { kind: "item", target: "lamp", step: { verb: "give", to: "pip" } },
      "give Lamp to Pip",
    ],
    [
      { kind: "item", target: "lamp", step: { verb: "bring", at: "hut" } },
      "bring Lamp to Hut",
    ],
    [
      { kind: "item", target: "jar", step: { verb: "bring", at: "hut" } },
      "bring Jar to Hut",
    ],
    [
      {
        kind: "item",
        target: "lamp",
        step: { verb: "bring", to: "pip", at: "hut" },
      },
      "bring Lamp to Pip at Hut",
    ],
    [
      { kind: "person", target: "ada", step: { verb: "bring", at: "bay" } },
      "bring Ada to Bay",
    ],
    [
      {
        kind: "item",
        target: "tea",
        step: { verb: "eat", with: "ada", at: "hut" },
      },
      "drink Tea with Ada at Hut",
    ],
    [{ kind: "item", target: "coat", step: { verb: "eat" } }, "eat Coat"],
    [
      {
        kind: "place",
        target: "hut",
        step: { verb: "lay", items: ["lamp", "coat"] },
      },
      "lay Lamp, Coat in Hut",
    ],
    [{ kind: "place", target: "hut", step: { verb: "rest" } }, "rest at Hut"],
    [{ kind: "connect", target: null }, "introduce two people"],
  ];
  for (const [want, words] of shapes)
    it(`words ${JSON.stringify(want)}`, () => {
      expect(say(want)).toBe(words);
    });

  it("words a place by the card's own approach", () => {
    const rest = { kind: "place", target: "hut", step: { verb: "rest" } };
    expect(say(rest, all, { approach: "go to" })).toBe(
      "go to Hut and rest there",
    );
    expect(say(rest, all, { approach: "discover" })).toBe(
      "discover Hut and rest there",
    );
    expect(
      say({ kind: "place", target: "hut" }, all, { approach: "discover" }),
    ).toBe("discover Hut");
  });

  it("shows an undiscovered card by its kind and never by name", () => {
    for (const [want, words] of [
      [{ kind: "item", target: "lamp" }, "find something"],
      [{ kind: "person", target: "pip" }, "meet someone"],
      [{ kind: "place", target: "hut" }, "discover somewhere"],
      [
        { kind: "item", target: "lamp", step: { verb: "find" } },
        "find something",
      ],
      [
        { kind: "item", target: "lamp", step: { verb: "find", at: "hut" } },
        "find something somewhere you haven't discovered",
      ],
      [
        { kind: "person", target: "pip", step: { verb: "attack" } },
        "strike someone you haven't met",
      ],
      [
        { kind: "person", target: "ada", step: { verb: "bring", at: "bay" } },
        "bring someone you haven't met somewhere you haven't discovered",
      ],
      [
        { kind: "person", target: "ada", step: { verb: "bring", to: "pip" } },
        "bring someone you haven't met to someone you haven't met",
      ],
      [
        {
          kind: "item",
          target: "tea",
          step: { verb: "eat", with: "ada", at: "hut" },
        },
        "drink something you haven't found with someone you haven't met somewhere you haven't discovered",
      ],
      [
        { kind: "place", target: "hut", step: { verb: "rest" } },
        "rest somewhere you haven't discovered",
      ],
      [
        { kind: "item", target: "lamp", step: { verb: "give", to: "pip" } },
        `give ${UNKNOWN.item} to ${UNKNOWN.person}`,
      ],
      [
        { kind: "item", target: "lamp", step: { verb: "bring", at: "hut" } },
        "find something, and bring it somewhere you haven't discovered",
      ],
      [
        {
          kind: "place",
          target: "hut",
          step: { verb: "lay", items: ["lamp", "coat"] },
        },
        "lay something you haven't found somewhere you haven't discovered",
      ],
    ]) {
      const text = say(want, none);
      expect(text).toBe(words);
      expect(text).not.toMatch(/Pip|Ada|Lamp|Tea|Coat|Hut|Bay/u);
    }
  });

  it("names exactly the discovered cards of a want", () => {
    const want = {
      kind: "item",
      target: "lamp",
      step: { verb: "bring", to: "pip", at: "hut" },
    };
    const text = (...found) => say(want, (id) => found.includes(id));
    expect(text()).toBe(
      "find something, and bring it to someone you haven't met somewhere you haven't discovered",
    );
    expect(text("pip", "hut")).toBe(
      "find something, and bring it to Pip at Hut",
    );
    expect(text("lamp")).toBe(
      "bring Lamp to someone you haven't met somewhere you haven't discovered",
    );
    expect(text("lamp", "pip")).toBe(
      "bring Lamp to Pip somewhere you haven't discovered",
    );
    expect(text("lamp", "pip", "hut")).toBe("bring Lamp to Pip at Hut");
  });

  it("puts no preposition before an unknown place", () => {
    const hid = (id) => id !== "hut";
    for (const [want, words] of [
      [
        { kind: "item", target: "lamp", step: { verb: "bring", at: "hut" } },
        "bring Lamp somewhere you haven't discovered",
      ],
      [
        { kind: "person", target: "ada", step: { verb: "bring", at: "hut" } },
        "bring Ada somewhere you haven't discovered",
      ],
      [
        { kind: "item", target: "coat", step: { verb: "eat", at: "hut" } },
        "eat Coat somewhere you haven't discovered",
      ],
      [
        {
          kind: "place",
          target: "hut",
          step: { verb: "lay", items: ["lamp"] },
        },
        "lay Lamp somewhere you haven't discovered",
      ],
      [
        { kind: "person", target: "pip", step: { verb: "attack", at: "hut" } },
        "strike Pip somewhere you haven't discovered",
      ],
    ])
      expect(say(want, hid)).toBe(words);
    expect(
      say(
        { kind: "item", target: "lamp", step: { verb: "bring", at: "hut" } },
        (id) => id === "hut",
      ),
    ).toBe("find something, and bring it to Hut");
  });

  it("words items, avatars and places alike: only the kind of card differs", () => {
    const seek = (kind, target) => say({ kind, target }, none);
    expect(seek("item", "lamp")).toBe(SEEK.item);
    expect(seek("person", "pip")).toBe(SEEK.person);
    expect(seek("place", "hut")).toBe(SEEK.place);
    expect(UNKNOWN).toEqual({
      item: "something you haven't found",
      person: "someone you haven't met",
      place: "somewhere you haven't discovered",
    });
  });

  it("is deterministic and leaves its input alone", () => {
    const want = {
      kind: "item",
      target: "lamp",
      step: { verb: "give", to: "pip" },
    };
    const before = JSON.stringify(want);
    expect(say(want, none)).toBe(say(want, none));
    expect(say(want)).toBe(say(want));
    expect(JSON.stringify(want)).toBe(before);
  });

  it("joins several wants plainly, the first beginning the sentence", () => {
    const wants = [
      { kind: "person", target: "pip" },
      { kind: "item", target: "lamp", step: { verb: "bring", at: "hut" } },
    ];
    const worded = (want) => {
      const words = say(want);
      return words[0].toUpperCase() + words.slice(1);
    };
    expect(joinWants(wants, worded)).toBe(
      "Talk with Pip and bring Lamp to Hut",
    );
    expect(joinWants([], worded)).toBe("");
  });
});

describe("what a lock waits on, from its conditions", () => {
  const flagOn = (key) => ({ kind: "flag", key, value: true });
  const worldOf = ({ met = [], choices = [] } = {}) => ({
    met: (condition) => met.includes(JSON.stringify(condition)),
    choices,
  });
  const given = (condition) => JSON.stringify(condition);
  const goals = (conditions, state) => goalsFrom(worldOf(state), conditions);

  it("reads each kind of condition as a want", () => {
    expect(goals([{ kind: "talked", person: "pip" }])).toEqual([
      { kind: "person", target: "pip" },
    ]);
    expect(goals([{ kind: "holding", item: "lamp", actor: "pip" }])).toEqual([
      { kind: "item", target: "lamp", step: { verb: "give", to: "pip" } },
    ]);
    expect(goals([{ kind: "holding", item: "lamp", role: "actor" }])).toEqual([
      { kind: "item", target: "lamp" },
    ]);
    for (const kind of ["item_near", "item_at", "item_present"])
      expect(goals([{ kind, item: "lamp", place: "hut" }])).toEqual([
        { kind: "item", target: "lamp", step: { verb: "bring", at: "hut" } },
      ]);
    expect(
      goals([{ kind: "light", item: "lamp", at: ["hut"], uncovered: true }]),
    ).toEqual([{ kind: "item", target: "lamp", lit: true }]);
    expect(
      goals([
        {
          kind: "not",
          condition: { kind: "light", item: "lamp", at: ["hut"] },
        },
      ]),
    ).toEqual([{ kind: "item", target: "lamp", lit: false }]);
  });

  it("leaves a condition that is met, or that names no one, unsaid", () => {
    const met = { kind: "talked", person: "pip" };
    expect(goals([met], { met: [given(met)] })).toEqual([]);
    expect(goals([{ kind: "clock", from: 0, to: 4 }])).toEqual([]);
    expect(goals([{ kind: "trusted", actor: "pip", min: 1 }])).toEqual([]);
    expect(goals(undefined)).toEqual([]);
  });

  it("states both parts of a compound condition, in order, each once", () => {
    const both = [
      { kind: "talked", person: "pip" },
      { kind: "item_near", item: "lamp", place: "hut" },
      { kind: "talked", person: "pip" },
    ];
    expect(goals(both)).toEqual([
      { kind: "person", target: "pip" },
      { kind: "item", target: "lamp", step: { verb: "bring", at: "hut" } },
    ]);
    // One met, the other remains.
    expect(goals(both, { met: [given(both[0])] })).toEqual([
      { kind: "item", target: "lamp", step: { verb: "bring", at: "hut" } },
    ]);
  });

  it("says the first alternative that can be said", () => {
    const either = {
      kind: "any",
      conditions: [
        { kind: "clock", from: 0, to: 4 },
        { kind: "item_at", item: "coat", place: "bay" },
        { kind: "talked", person: "ada" },
      ],
    };
    expect(goals([either])).toEqual([
      { kind: "item", target: "coat", step: { verb: "bring", at: "bay" } },
    ]);
  });

  it("follows a flag to the choice that sets it: a give, or a meeting", () => {
    const choices = [
      {
        id: "hand-over",
        subject: "pip",
        on: "give",
        requires: [{ kind: "holding", item: "lamp", role: "actor" }],
        effects: [{ kind: "set_flag", key: "handed", value: true }],
      },
      {
        id: "greet",
        subject: "ada",
        on: "meet",
        requires: [],
        effects: [{ kind: "set_flag", key: "greeted", value: true }],
      },
    ];
    expect(goals([flagOn("handed")], { choices })).toEqual([
      { kind: "item", target: "lamp", step: { verb: "give", to: "pip" } },
    ]);
    expect(goals([flagOn("greeted")], { choices })).toEqual([
      { kind: "person", target: "ada" },
    ]);
    // A flag nothing in the pack sets has no want to show.
    expect(goals([flagOn("mystery")], { choices })).toEqual([]);
  });

  it("follows a choice value to the play that makes it", () => {
    const choices = [
      {
        id: "pick-sea",
        subject: "ada",
        on: "give",
        requires: [{ kind: "holding", item: "coat", role: "actor" }],
        effects: [{ kind: "choose", key: "road", value: "sea" }],
      },
      {
        id: "pick-hill",
        subject: "pip",
        on: "give",
        requires: [{ kind: "holding", item: "coat", role: "actor" }],
        effects: [{ kind: "choose", key: "road", value: "hill" }],
      },
    ];
    expect(
      goals([{ kind: "choice", key: "road", value: "hill" }], { choices }),
    ).toEqual([
      { kind: "item", target: "coat", step: { verb: "give", to: "pip" } },
    ]);
  });

  it("states what a play needs before the play, one step at a time", () => {
    const choices = [
      {
        id: "step-one",
        subject: "ada",
        on: "meet",
        requires: [],
        effects: [{ kind: "set_flag", key: "one", value: true }],
      },
      {
        id: "step-two",
        subject: "pip",
        on: "give",
        requires: [
          flagOn("one"),
          { kind: "holding", item: "lamp", role: "actor" },
        ],
        effects: [{ kind: "set_flag", key: "two", value: true }],
      },
    ];
    expect(goals([flagOn("two")], { choices })).toEqual([
      { kind: "person", target: "ada" },
    ]);
    expect(
      goals([flagOn("two")], { choices, met: [given(flagOn("one"))] }),
    ).toEqual([
      { kind: "item", target: "lamp", step: { verb: "give", to: "pip" } },
    ]);
  });

  it("stops at a cycle of choices", () => {
    const choices = [
      {
        id: "a",
        subject: "ada",
        on: "meet",
        requires: [flagOn("b")],
        effects: [{ kind: "set_flag", key: "a", value: true }],
      },
      {
        id: "b",
        subject: "pip",
        on: "meet",
        requires: [flagOn("a")],
        effects: [{ kind: "set_flag", key: "b", value: true }],
      },
    ];
    expect(goals([flagOn("a")], { choices })).toHaveLength(1);
  });

  it("is deterministic and reads without changing anything", () => {
    const conditions = [
      { kind: "talked", person: "pip" },
      { kind: "item_near", item: "lamp", place: "hut" },
    ];
    const before = JSON.stringify(conditions);
    expect(goals(conditions)).toEqual(goals(conditions));
    expect(JSON.stringify(conditions)).toBe(before);
  });
});

describe("a lock in a real world shows only what the traveler knows", () => {
  const table = JSON.parse(
    readFileSync(
      new URL("../v2/worlds/card-table.json", import.meta.url),
      "utf8",
    ),
  );
  // A world with every pack open and nothing in the traveler's hands.
  const world = () => {
    const s = createWorld({ opening: false, seed: 17 });
    for (const pack of Object.values(s.packs))
      if (pack.scope) pack.scope = "full";
    return s;
  };
  const names = [
    ...Object.values(people),
    ...Object.values(things),
    ...Object.values(places),
  ]
    .map((card) => card.name)
    // Short or common words would match inside the unknown phrases.
    .filter((name) => name && name.length > 3);

  it("mounts the packs the checks below walk", () => {
    expect(table.packs.length).toBeGreaterThan(3);
    expect(boxDefs().length).toBeGreaterThan(40);
  });

  it("gives every lock a want of its own, from its data and nothing authored", () => {
    const s = world();
    const empty = [];
    for (const def of boxDefs()) {
      const goalsOfBox = goalsFor(s, def, "vale").slice(0, MOST_GOALS);
      if (!goalsOfBox.length) empty.push(`${def.kind}:${def.at}>${def.id}`);
      for (const goal of goalsOfBox) {
        expect(["item", "person", "place"], def.id).toContain(goal.kind);
        expect(goal.target, def.id).toBeTruthy();
      }
    }
    // A lock the data cannot word shows only that it is shut; it must stay
    // the exception.
    expect(empty.length, empty.join(", ")).toBeLessThanOrEqual(2);
  });

  it("names no card a fresh traveler has not discovered", () => {
    const s = world();
    let shown = 0;
    for (const def of boxDefs()) {
      s.actors.vale.place = def.at;
      const text = lockWords(s, def.id);
      // Not shut at this moment in this world: nothing to show.
      if (text === null) continue;
      shown++;
      expect(text, def.id).toMatch(/\S/u);
      for (const name of names)
        expect(text, `${def.id} must not name ${name}`).not.toContain(name);
    }
    // Attica's six residents and two roads no longer lie shut.
    expect(shown).toBeGreaterThan(20);
  });

  it("names a card once it is discovered", () => {
    const s = world();
    const def = boxDefs().find((d) => d.id === "greek-egypt-tomb");
    s.actors.vale.place = def.at;
    expect(lockWords(s, def.id)).not.toContain("Tablet");
    expect(lockWords(s, def.id, () => true)).toContain("Tablet");
  });

  it("words a quest offered to a fresh traveler without its undiscovered names", () => {
    const told = journeyWorlds(questCards).told;
    // Quests stand held at once (rules 134), so the held ones are read.
    const offers = questsOf(told, "vale").map((want) => ({ id: want.from, want }));
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      const quest = { actor: "vale", ...offer.want };
      const blind = questCaption(quest, false, null, () => false);
      for (const name of names)
        expect(blind, `${offer.id} must not name ${name}`).not.toContain(name);
      // Discovered, the same want names its cards.
      expect(questCaption(quest, false, null, () => true)).not.toBe(blind);
    }
  });
});
