import { test } from "vitest";
import assert from "node:assert/strict";
import {
  streamSchedule,
  titleIntroWanted,
} from "../v2/card-game/title-intro.mjs";
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

test("the acknowledgement breathes after its weighty words, in about 10 s", () => {
  const { schedule, end } = streamSchedule(acknowledgement);
  const letters = schedule.flat();
  const words = letters.map(({ letter }) => letter).join("");
  const gap = (phrase) => {
    const i = words.indexOf(phrase) + phrase.length - 1;
    return letters[i + 1].at - letters[i].at;
  };
  const plain = streamSchedule({ ...acknowledgement, pauses: [] });
  assert.ok(gap("there was land.") > 300);
  assert.ok(gap("were peoples") > 300);
  assert.ok(gap("Nothing") > 300);
  // A pause after punctuation takes the larger breath, not both.
  assert.equal(gap("there was land."), 9 + 420);
  assert.ok(end > plain.end && end <= 10_000, `${end} ms`);
  for (const { word } of acknowledgement.pauses)
    assert.ok(
      acknowledgement.paragraphs.some(({ text }) => text.includes(word)),
    );
});
