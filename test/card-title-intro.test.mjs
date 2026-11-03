import { test } from "vitest";
import assert from "node:assert/strict";
import {
  STANZA_MS,
  acknowledgementDelays,
  acknowledgementPauses,
  titleIntroWanted,
} from "../v2/card-game/title-intro.mjs";
import {
  REVEAL_FADE_MS,
  letterDelay,
  splitLetters,
} from "../v2/card-game/dialogue.mjs";
import acknowledgement from "../v2/card-game/acknowledgement.json" with { type: "json" };

const storage = (entries = {}) => ({
  getItem: (key) => (key in entries ? entries[key] : null),
});
const wanted = (overrides = {}) =>
  titleIntroWanted({
    href: "https://lonelyforest.com/",
    storage: storage(),
    local: false,
    webdriver: false,
    ...overrides,
  });

test("the title opens a new local world, not a resumed one", () => {
  assert.equal(wanted(), true);
  // A browser that saw it before still sees it for a new world.
  assert.equal(
    wanted({ storage: storage({ "cosyworld.title-intro": "seen" }) }),
    true,
  );
  for (const key of ["cosyworld.reflected-shore.v1", "cosyworld.playing"])
    assert.equal(wanted({ storage: storage({ [key]: "x" }) }), false, key);
  for (const href of [
    "https://lonelyforest.com/?table=t",
    "https://lonelyforest.com/?pack=greek-drama",
    "https://hoppy.lonelyforest.com/",
  ])
    assert.equal(wanted({ href }), false, href);
  assert.equal(wanted({ local: true }), false);
});

test("a shared world shows it once, after this browser made or joined it", () => {
  const href = "https://lonelyforest.com/?world=w1";
  assert.equal(wanted({ href }), false);
  const due = storage({ "cosyworld.title-intro": "w1" });
  assert.equal(wanted({ href, storage: due }), true);
  assert.equal(
    wanted({ href: "https://lonelyforest.com/?world=w2", storage: due }),
    false,
  );
});

test("blocked storage shows it; automated browsers need intro=1", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(wanted({ storage: blocked }), true);
  assert.equal(wanted({ storage: null }), true);
  assert.equal(
    wanted({ storage: blocked, href: "https://lonelyforest.com/?world=w1" }),
    false,
  );
  assert.equal(wanted({ webdriver: true }), false);
  assert.equal(
    wanted({ webdriver: true, href: "https://lonelyforest.com/?intro=1" }),
    true,
  );
});

test("the acknowledgement is the owner's five stanzas, line by line, and nothing else", () => {
  const { stanzas } = acknowledgement;
  assert.deepEqual(
    stanzas.map((lines) => lines.length),
    [6, 5, 1, 2, 1],
  );
  assert.deepEqual(stanzas[0].slice(0, 2), [
    "Before our forest, there was land.",
    "Before our story, there were peoples;",
  ]);
  assert.equal(stanzas[0][4], "who cared for these lands —");
  assert.equal(
    stanzas[1][4],
    "whose stories taught those machines — and us — to tell our own.",
  );
  assert.deepEqual(stanzas[2], ["Nothing here began with us."]);
  assert.deepEqual(stanzas[3], [
    "We offer back a carved wooden box,",
    "a forest folded within.",
  ]);
  assert.deepEqual(stanzas[4], ["Open the box. The path is yours."]);
  for (const line of stanzas.flat()) {
    assert.equal(line, line.trim());
    assert.doesNotMatch(line, /\S—|—\S/u, "em dashes are spaced");
  }
  assert.equal(acknowledgement.credit, undefined);
  assert.doesNotMatch(
    JSON.stringify(acknowledgement),
    /Cenetex|RATi|Foundation|rati\.foundation/u,
  );
});

test("the acknowledgement writes at the dialogue's beat, breathing after its weighty words", () => {
  const delays = acknowledgementDelays(acknowledgement);
  const words = acknowledgement.stanzas.flat().join("");
  const letters = splitLetters(words);
  assert.equal(delays.length, letters.length);
  const after = (phrase) =>
    delays[
      splitLetters(words.slice(0, words.indexOf(phrase) + phrase.length))
        .length - 1
    ];
  assert.equal(after("there was land."), 320);
  assert.equal(after("were peoples;"), 320);
  assert.equal(after("first keepers"), 300);
  assert.equal(after("and us —"), 320);
  assert.equal(after("began with us."), STANZA_MS);
  // Stanzas hold the same breath; nothing else rests past a word hold,
  // and between rests every letter keeps the dialogue's own beat.
  const ends = new Set();
  let at = -1;
  for (const lines of acknowledgement.stanzas.slice(0, -1))
    ends.add((at += splitLetters(lines.join("")).length));
  delays.forEach((ms, i) => {
    if (ends.has(i)) assert.equal(ms, STANZA_MS);
    else
      assert.ok(
        ms === letterDelay(letters[i]) || (ms >= 300 && ms <= 350),
        `${i}: ${ms}`,
      );
  });
  assert.ok(STANZA_MS >= 600 && STANZA_MS <= 700);
  const total = delays.slice(0, -1).reduce((sum, ms) => sum + ms, 28);
  assert.ok(total > 16_000 && total < 18_500, `${total} ms`);
  // A letter fades in over less than three beats: at most three are soft.
  assert.ok(Math.ceil(REVEAL_FADE_MS / 28) <= 3);
  // Every pause finds its word, in the order the poem reads.
  const pauses = acknowledgementPauses(acknowledgement);
  assert.deepEqual(
    pauses.map(({ word }) => word),
    acknowledgement.pauses.map(({ word }) => word),
  );
  pauses
    .slice(1)
    .forEach((p, i) =>
      assert.ok(p.line > pauses[i].line || p.start > pauses[i].start),
    );
});
