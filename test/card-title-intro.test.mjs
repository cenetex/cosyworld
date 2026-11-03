import { test } from "vitest";
import assert from "node:assert/strict";
import {
  PARAGRAPH_MS,
  acknowledgementDelays,
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

test("the acknowledgement is the owner's five paragraphs and nothing else", () => {
  const { paragraphs } = acknowledgement;
  assert.equal(paragraphs.length, 5);
  assert.match(paragraphs[0].text, /^Before our forest, there was land\./);
  assert.match(paragraphs[0].text, /cared for it—and who care for it still\.$/);
  assert.equal(paragraphs[2].text, "Nothing here began with us.");
  assert.match(paragraphs[3].text, /a forest folded inside\.$/);
  assert.equal(paragraphs.at(-1).text, "The lid is open. The path is yours.");
  for (const { text, links = {} } of paragraphs)
    for (const phrase of Object.keys(links)) assert.ok(text.includes(phrase));
  assert.equal(acknowledgement.credit, undefined);
  assert.doesNotMatch(
    JSON.stringify(acknowledgement),
    /Cenetex|RATi|Foundation|rati\.foundation/u,
  );
});

test("the acknowledgement writes at the dialogue's beat, breathing after its weighty words", () => {
  const delays = acknowledgementDelays(acknowledgement);
  const words = acknowledgement.paragraphs.map(({ text }) => text).join("");
  const letters = splitLetters(words);
  assert.equal(delays.length, letters.length);
  const after = (phrase) =>
    delays[
      splitLetters(words.slice(0, words.indexOf(phrase) + phrase.length))
        .length - 1
    ];
  assert.equal(after("there was land."), 350);
  assert.equal(after("were peoples"), 300);
  assert.equal(after("Nothing"), 350);
  // Paragraphs hold the same breath; nothing else rests past a word hold,
  // and between rests every letter keeps the dialogue's own beat.
  const ends = new Set();
  let at = -1;
  for (const { text } of acknowledgement.paragraphs.slice(0, -1))
    ends.add((at += splitLetters(text).length));
  delays.forEach((ms, i) => {
    if (ends.has(i)) assert.equal(ms, PARAGRAPH_MS);
    else
      assert.ok(
        ms === letterDelay(letters[i]) || (ms >= 250 && ms <= 350),
        `${i}: ${ms}`,
      );
  });
  assert.ok(PARAGRAPH_MS >= 600 && PARAGRAPH_MS <= 700);
  const total = delays.slice(0, -1).reduce((sum, ms) => sum + ms, 28);
  assert.ok(total > 14_000 && total < 18_000, `${total} ms`);
  // A letter fades in over less than three beats: at most three are soft.
  assert.ok(Math.ceil(REVEAL_FADE_MS / 28) <= 3);
  for (const { word } of acknowledgement.pauses)
    assert.ok(
      acknowledgement.paragraphs.some(({ text }) => text.includes(word)),
    );
});
