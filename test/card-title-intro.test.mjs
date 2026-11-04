import { test } from "vitest";
import assert from "node:assert/strict";
import {
  STANZA_MS,
  acknowledgementDelays,
  acknowledgementGlows,
  acknowledgementHighlights,
  acknowledgementPauses,
  titleIntroWanted,
} from "../v2/card-game/title-intro.mjs";
import { tiers } from "../v2/card-game/level-tiers.mjs";
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

test("the acknowledgement is the owner's six stanzas, line by line, and nothing else", () => {
  assert.deepEqual(acknowledgement.stanzas, [
    [
      "Before our forest, there was land.",
      "Before our story, there were peoples",
      "who named the waters,",
      "who sang the seasons,",
      "who cared for these lands—",
      "and who care for them still.",
    ],
    [
      "We honour the keepers",
      "of the lands beneath our homes",
      "and beneath the machines we use.",
    ],
    [
      "We honour, too, the voices old and living",
      "whose stories shaped us",
      "and echo through our machines.",
    ],
    ["Nothing here began with us."],
    [
      "Before you sits an intricately carved wooden box,",
      "its surface rippling with stories",
      "older than either of us.",
    ],
    ["Will you take it?"],
  ]);
  assert.doesNotMatch(JSON.stringify(acknowledgement.stanzas), /\[hold\]/);
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
  assert.equal(after("were peoples"), 320);
  assert.equal(after("the keepers"), 300);
  assert.equal(after("Nothing"), 300);
  // A lit stanza holds 200 + 450 per word + 250 ms, for its own break.
  assert.equal(after("for them still."), 2250);
  assert.equal(after("the machines we use."), 1800);
  assert.equal(after("our machines."), 1800);
  assert.equal(after("either of us."), 2250);
  // One long silence before "Before you sits", with no word shown for it.
  const silence = after("began with us.");
  assert.equal(silence, 1800, "Nothing lights inside it");
  // Other stanzas hold the same breath; nothing else rests past a word
  // hold, and between rests every letter keeps the dialogue's own beat.
  const ends = new Set();
  let at = -1;
  for (const lines of acknowledgement.stanzas.slice(0, -1))
    ends.add((at += splitLetters(lines.join("")).length));
  delays.forEach((ms, i) => {
    if (ends.has(i)) assert.ok([silence, 2250].includes(ms), `${i}: ${ms}`);
    else
      assert.ok(
        ms === letterDelay(letters[i]) || (ms >= 300 && ms <= 320),
        `${i}: ${ms}`,
      );
  });
  assert.ok(STANZA_MS >= 600 && STANZA_MS <= 700);
  const total = delays.slice(0, -1).reduce((sum, ms) => sum + ms, 28);
  assert.ok(total > 24_000 && total < 26_000, `${total} ms`);
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

test("single words light set by set after their stanzas, tiers climbing", () => {
  const pauses = acknowledgementHighlights(acknowledgement);
  const lines = acknowledgement.stanzas.flat();
  assert.deepEqual(
    pauses.map(({ word, tier, atMs }) => `${word} ${tier} ${atMs}`),
    [
      ...["peoples", "waters", "seasons", "lands"].map(
        (word, i) => `${word} uncommon ${200 + 450 * i}`,
      ),
      ...["keepers", "homes", "machines"].map(
        (word, i) => `${word} rare ${200 + 450 * i}`,
      ),
      ...["voices", "stories", "echo"].map(
        (word, i) => `${word} epic ${200 + 450 * i}`,
      ),
      "Nothing legendary 600",
      ...["intricately", "carved", "wooden", "box"].map(
        (word, i) => `${word} mythic ${200 + 450 * i}`,
      ),
    ],
  );
  // Only the named occurrence lights: "these lands", the first "machines"
  // and "stories", never the last line.
  const line = (word) => lines[pauses.find((p) => p.word === word).line];
  assert.equal(line("lands"), "who cared for these lands—");
  assert.equal(line("machines"), "and beneath the machines we use.");
  assert.equal(line("stories"), "whose stories shaped us");
  assert.ok(pauses.every((p) => p.phrase === p.word && p.line < 16));
  const rank = (id) => tiers.find((tier) => tier.id === id).rank;
  const ranks = pauses.map(({ tier }) => rank(tier));
  ranks.slice(1).forEach((r, i) => assert.ok(r >= ranks[i], "tiers climb"));
  assert.equal(ranks[0], 1);
  assert.equal(ranks.at(-1), tiers.at(-1).rank);
  // Each set is due once its stanza's last letter is written, never while
  // text writes, and stays lit; a tap that shows the rest lights them all.
  const lit = acknowledgementGlows(acknowledgement);
  const delays = acknowledgementDelays(acknowledgement);
  const total = splitLetters(lines.join("")).length;
  pauses.forEach(({ written }, i) => {
    assert.equal(lit(written - 1, false)[i], false);
    assert.equal(lit(written, false)[i], true);
    assert.equal(delays[written - 1], Math.max(1800, pauses[i].pauseMs));
  });
  assert.ok(lit(total - 1, false).every(Boolean));
  assert.deepEqual(lit(40, true), lit(total, true));
  const { settleMs, wordStepMs, glowInMs, tailMs } = acknowledgement;
  assert.deepEqual(
    [settleMs, wordStepMs, glowInMs, tailMs],
    [200, 450, 600, 250],
  );
});
