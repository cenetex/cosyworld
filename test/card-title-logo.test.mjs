import { test } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  LOGOS,
  chooseLogo,
  logoSite,
  rememberLogo,
  worldLogo,
  worldLogoKey,
} from "../v2/card-game/title-logo.mjs";

const memoryStorage = () => {
  const entries = new Map();
  return {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, String(value)),
  };
};
const at = (search) => `https://lonelyforest.com/${search}`;

test("the logo set is data with real files and sizes", () => {
  assert.ok(LOGOS.length >= 2);
  for (const logo of LOGOS) {
    assert.ok(
      existsSync(new URL(`../v2/card-game/${logo.src}`, import.meta.url)),
    );
    assert.ok(logo.name && logo.width > 0 && logo.height > 0, logo.src);
  }
});

test("each address names its world", () => {
  assert.equal(worldLogoKey(at("")), "local");
  assert.equal(worldLogoKey(at("?world=w1")), "world:w1");
  assert.equal(worldLogoKey(at("?table=logo1")), "table:logo1");
  assert.equal(worldLogoKey(at("?table=bad%20name")), "local");
  assert.equal(worldLogoKey(at("?pack=greek-drama")), "pack:greek-drama");
});

test("a world keeps its logo and a new world avoids the last one", () => {
  const first = chooseLogo("world:a", {}, 2);
  assert.equal(
    chooseLogo("world:a", {}, 2),
    first,
    "deterministic from the id",
  );
  let memory = rememberLogo({}, "world:a", first);
  assert.equal(chooseLogo("world:a", memory, 2), first);
  const second = chooseLogo("world:b", memory, 2);
  assert.notEqual(second, first);
  memory = rememberLogo(memory, "world:b", second);
  assert.equal(chooseLogo("world:a", memory, 2), first, "a return keeps it");
  assert.equal(chooseLogo("solo", { last: 0 }, 1), 0);
});

test("worldLogo remembers reloads; a fresh world switches logos", () => {
  const storage = memoryStorage();
  const one = worldLogo({ href: at("?table=logo1"), storage });
  assert.equal(worldLogo({ href: at("?table=logo1"), storage }), one);
  const two = worldLogo({ href: at("?table=logo2"), storage });
  assert.notEqual(two, one);
  const again = worldLogo({ href: at("?table=logo2"), storage, fresh: true });
  assert.notEqual(again, two, "New game never repeats the last logo");
  // Blocked storage still yields a logo.
  assert.ok(LOGOS.includes(worldLogo({ href: at(""), storage: null })));
});

test("only Lonely Forest shows its logos", () => {
  assert.equal(logoSite({ href: at("?table=t"), local: false }), true);
  assert.equal(logoSite({ href: at(""), local: true }), false);
  assert.equal(
    logoSite({ href: "https://hoppy.lonelyforest.com/", local: false }),
    false,
  );
});
