import { test } from "vitest";
import assert from "node:assert/strict";
import { titleIntroWanted } from "../v2/card-game/title-intro.mjs";

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

test("the title greets only a first arrival at the Lonely Forest root", () => {
  assert.equal(wanted(), true);
  for (const key of [
    "cosyworld.reflected-shore.v1",
    "cosyworld.playing",
    "cosyworld.title-intro",
  ])
    assert.equal(wanted({ storage: storage({ [key]: "x" }) }), false, key);
  for (const href of [
    "https://lonelyforest.com/?world=w1",
    "https://lonelyforest.com/?table=t",
    "https://lonelyforest.com/?pack=greek-drama",
    "https://hoppy.lonelyforest.com/",
  ])
    assert.equal(wanted({ href }), false, href);
  assert.equal(wanted({ local: true }), false);
});

test("blocked storage shows it; automated browsers need ?intro=1", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(wanted({ storage: blocked }), true);
  assert.equal(wanted({ storage: null }), true);
  assert.equal(wanted({ webdriver: true }), false);
  assert.equal(
    wanted({ webdriver: true, href: "https://lonelyforest.com/?intro=1" }),
    true,
  );
});
