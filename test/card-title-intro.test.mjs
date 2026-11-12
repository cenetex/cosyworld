import { test } from "vitest";
import assert from "node:assert/strict";
import {
  STANZA_MS,
  STEP_GUARD_MS,
  acknowledgementStep,
  openingDealFrames,
  BOX_WHISPERS,
  acknowledgementDelays,
  acknowledgementGlows,
  acknowledgementHighlights,
  acknowledgementPauses,
  titleIntroWanted,
  whisperTier,
  whisperLine,
} from "../v2/card-game/title-intro.mjs";
import { tiers } from "../v2/card-game/level-tiers.mjs";
import {
  REVEAL_FADE_MS,
  createTextReveal,
  letterDelay,
  splitLetters,
} from "../v2/card-game/dialogue.mjs";
import acknowledgement from "../v2/card-game/acknowledgement.json" with { type: "json" };

const storage = (entries = {}) => ({
  getItem: (key) => (key in entries ? entries[key] : null),
});
test("whispers show every colour, with the top tiers sharing one percent", () => {
  const counts = tiers.map(() => 0);
  for (let i = 0; i < 1000; i++) counts[whisperTier((i + 0.5) / 1000).rank]++;
  assert.deepEqual(counts, [640, 240, 80, 30, 8, 2]);
});
test("twelve whispers share their tier's colour and avoid an immediate repeat", () => {
  assert.equal(new Set(BOX_WHISPERS.flat()).size, 12);
  for (const tier of tiers) {
    const first = whisperLine(tier, "", 0);
    const second = whisperLine(tier, "", 0.99);
    assert.notEqual(first, second);
    for (const draw of [0, 0.5, 0.99]) {
      assert.equal(whisperLine(tier, first, draw), second);
      assert.equal(whisperLine(tier, second, draw), first);
    }
  }
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
  for (const end of [
    "for them still.",
    "the machines we use.",
    "our machines.",
    "either of us.",
  ])
    assert.equal(after(end), STANZA_MS, "no stanza waits for its colour");
  // One long silence before "Before you sits", with no word shown for it.
  const silence = after("began with us.");
  assert.equal(silence, 1800, "Nothing lights inside it");
  // Nothing else rests past a word hold, and between rests every letter
  // keeps the dialogue's own beat.
  const ends = new Set();
  let at = -1;
  for (const lines of acknowledgement.stanzas.slice(0, -1))
    ends.add((at += splitLetters(lines.join("")).length));
  delays.forEach((ms, i) => {
    if (ends.has(i))
      assert.ok([silence, STANZA_MS].includes(ms), `${i}: ${ms}`);
    else
      assert.ok(
        ms === letterDelay(letters[i]) || (ms >= 300 && ms <= 320),
        `${i}: ${ms}`,
      );
  });
  assert.ok(STANZA_MS >= 600 && STANZA_MS <= 700);
  const total = delays.slice(0, -1).reduce((sum, ms) => sum + ms, 28);
  assert.ok(total > 18_500 && total < 20_500, `${total} ms`);
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

test("single words light set by set as the next stanza starts, tiers climbing", () => {
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
  // Each set is due at the next stanza's first letter and stays lit; the
  // set with its own settle lights inside the silence already after it.
  const lit = acknowledgementGlows(acknowledgement);
  const delays = acknowledgementDelays(acknowledgement);
  const total = splitLetters(lines.join("")).length;
  pauses.forEach(({ word, written, due }, i) => {
    const own = word === "Nothing";
    assert.equal(due, written + (own ? 0 : 1), word);
    assert.equal(lit(due - 1, false)[i], false);
    assert.equal(lit(due, false)[i], true);
    assert.equal(delays[written - 1], own ? 1800 : STANZA_MS);
  });
  assert.ok(lit(total - 1, false).every(Boolean));
  assert.deepEqual(lit(40, true), lit(total, true));
  const { settleMs, wordStepMs, glowInMs } = acknowledgement;
  assert.deepEqual([settleMs, wordStepMs, glowInMs], [200, 450, 600]);
  assert.equal("tailMs" in acknowledgement, false);
});

test("a stanza's colour starts with the next stanza; the last starts at its own end", () => {
  const poem = {
    stanzas: [["One two."], ["Three four."], ["Five six."]],
    settleMs: 100,
    wordStepMs: 50,
    highlights: [
      {
        stanza: 1,
        tier: "uncommon",
        words: [{ word: "One" }, { word: "two" }],
      },
      { stanza: 2, tier: "rare", words: [{ word: "four" }] },
      { stanza: 3, tier: "epic", words: [{ word: "Five" }, { word: "six" }] },
    ],
  };
  const sets = acknowledgementHighlights(poem);
  assert.deepEqual(
    sets.map(({ word, written, due, atMs }) => [word, written, due, atMs]),
    [
      ["One", 8, 9, 100],
      ["two", 8, 9, 150],
      ["four", 19, 20, 100],
      ["Five", 28, 28, 100],
      ["six", 28, 28, 150],
    ],
  );
  const lit = acknowledgementGlows(poem);
  assert.deepEqual(lit(8, false), [false, false, false, false, false]);
  assert.deepEqual(lit(9, false), [true, true, false, false, false]);
  assert.deepEqual(lit(20, false), [true, true, true, false, false]);
  assert.deepEqual(lit(27, false), [true, true, true, false, false]);
  assert.deepEqual(lit(28, true), [true, true, true, true, true]);
  assert.deepEqual(lit(0, true), [true, true, true, true, true]);
  const delays = acknowledgementDelays(poem);
  assert.equal(delays[7], STANZA_MS);
  assert.equal(delays[18], STANZA_MS);
  assert.equal(delays[27], 180);
});

function pen({ reduced = false } = {}) {
  let time = 0,
    last = null,
    stepAt = -Infinity;
  const queued = [];
  const reveal = createTextReveal({
    frame: (value) => (last = value),
    reduced: () => reduced,
    delay: () => 28,
    now: () => time,
    requestFrame: (callback) => queued.push(callback),
    cancelFrame: () => queued.splice(0),
  });
  reveal.show("poem", "One two. Three four. Five six.", null);
  const run = (ms) => {
    for (const end = time + ms; time < end; ) {
      time += 4;
      queued.splice(0).forEach((callback) => callback());
    }
  };
  const press = () => {
    const step = acknowledgementStep({
      complete: reveal.complete,
      quick: reveal.quick,
      sinceStepMs: time - stepAt,
    });
    if (step === "quicken" || step === "finish") stepAt = time;
    if (step === "quicken") reveal.accelerate(8);
    if (step === "finish") reveal.finish();
    return step;
  };
  return { reveal, run, press, shown: () => last.shown, last: () => last };
}

test("a first press quickens the stanza; a second in fast mode finishes it all", () => {
  const { reveal, run, press, shown, last } = pen();
  run(60);
  assert.ok(shown() >= 1 && shown() < 4);
  assert.equal(press(), "quicken");
  assert.equal(reveal.quick, true);
  run(8);
  assert.ok(shown() < 8, "still writing, quickly");
  assert.equal(press(), "finish");
  assert.equal(reveal.quick, false);
  assert.equal(reveal.complete, true);
  assert.equal(shown(), 30);
  assert.equal(last().instant, true);
});

test("fast mode ends with its stanza: the next press quickens again", () => {
  const { reveal, run, press, shown } = pen();
  assert.equal(press(), "quicken");
  run(200);
  assert.equal(reveal.quick, false);
  assert.ok(shown() >= 8 && shown() < 30);
  assert.equal(press(), "quicken");
});

test("a press on the finished text continues, but never in the tap that finished it", () => {
  const { reveal, run, press } = pen();
  run(40);
  assert.equal(press(), "quicken");
  run(8);
  assert.equal(press(), "finish");
  run(STEP_GUARD_MS - 60);
  assert.equal(press(), "wait");
  assert.equal(press(), "wait");
  run(80);
  assert.equal(press(), "continue");
  const alone = pen();
  alone.run(2000);
  assert.equal(alone.reveal.complete, true);
  assert.equal(alone.press(), "continue");
  assert.equal(reveal.complete, true);
});

test("a double tap as the last stanza ends does not continue", () => {
  for (const [complete, quick, sinceStepMs, step] of [
    [false, false, Infinity, "quicken"],
    [false, true, 0, "finish"],
    [false, true, 5000, "finish"],
    [true, false, 0, "wait"],
    [true, false, STEP_GUARD_MS - 1, "wait"],
    [true, false, STEP_GUARD_MS, "continue"],
    [true, false, Infinity, "continue"],
  ])
    assert.equal(acknowledgementStep({ complete, quick, sinceStepMs }), step);
});

test("reduced motion shows the whole text lit, and one press continues", () => {
  const { reveal, press, shown, last } = pen({ reduced: true });
  assert.equal(shown(), 30);
  assert.equal(last().instant, true);
  assert.equal(reveal.complete, true);
  assert.equal(reveal.quick, false);
  const lit = acknowledgementGlows(acknowledgement);
  assert.ok(lit(last().shown, last().complete).every(Boolean));
  assert.equal(press(), "continue");
});

test("opening cards fan from the box into their own hand slots", () => {
  for (const width of [390, 1440]) {
    const origin = { left: width / 2 - 80, top: 300, width: 160, height: 240 };
    const targets = [0, 1, 2].map((index) => ({
      left: 20 + index * 90,
      top: 600,
      width: 120,
      height: 180,
    }));
    const plans = targets.map((target, i) =>
      openingDealFrames(origin, target, i, targets.length),
    );
    for (const [i, plan] of plans.entries()) {
      assert.equal(
        plan[0].transform,
        `translate(${origin.left + 80 - targets[i].left - 60}px, -270px) scale(${160 / 120}, ${240 / 180})`,
      );
      assert.deepEqual(plan.at(-1), { transform: "rotate(0deg)", opacity: 1 });
      assert.equal(plan[1].offset, 0.3);
      assert.ok(
        plan.every((frame) => frame.opacity === 1),
        "the box stays opaque through the deal",
      );
    }
    assert.match(plans[0][1].transform, /rotate\(-4deg\)/);
    assert.match(plans[2][1].transform, /rotate\(4deg\)/);
  }
});

test("opening cards settle at the original hand lean", () => {
  const box = { left: 10, top: 10, width: 120, height: 180 };
  assert.equal(
    openingDealFrames(box, box, 0, 2, "-1.2deg").at(-1).transform,
    "rotate(-1.2deg)",
  );
});
