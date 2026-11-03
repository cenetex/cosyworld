import { test } from "vitest";
import assert from "node:assert/strict";
import { titleIntroWanted } from "../v2/card-game/title-intro.mjs";
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

test("the acknowledgement quotes RATi's statement and names its link", () => {
  const quoted = acknowledgement.paragraphs.filter((p) => p.source);
  assert.equal(quoted.length, 4);
  assert.match(quoted[1].text, /^The RATi Open Software Foundation has no/);
  assert.equal(
    quoted[1].links["RATi Open Software Foundation"],
    "https://rati.foundation/about/#land",
  );
  for (const { text, links = {} } of acknowledgement.paragraphs)
    for (const phrase of Object.keys(links)) assert.ok(text.includes(phrase));
  assert.match(acknowledgement.paragraphs.at(-1).text, /wooden box/);
  assert.match(acknowledgement.credit, /All revenue goes to the Foundation$/);
});
