import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { readingDigest, utf8Length } from "../v2/card-game/reading-digest.mjs";
import {
  makeReadingCatalog,
  emptyPoemReadings,
  setReadingDraft,
  beginReading,
  publishReadingPage,
  replayReadingPage,
  readingPage,
  heardReadingPages,
  sharedHeardPages,
  validPoemReadings,
  readingBlockBytes,
  readingLimits,
} from "../v2/card-game/poem-readings.mjs";

const court = "greek-viii-poets-court";
const poets = ["greek-viii-aeschylus", "greek-viii-euripides"];
const siteIds = [
  "greek-vii-cyclops-homecoming",
  "greek-vii-birds-homecoming",
  "greek-vii-peace-homecoming",
  "greek-vii-prometheus-homecoming",
  "greek-viii-frogs-court",
  "greek-viii-frogs-homecoming",
];
function fixture(count = 6) {
  const verses = Array.from({ length: count }, (_, i) => ({
    choice: `earned-${i}`,
    quest: "journey",
    lines: [
      `I carried the account through gate ${i}.`,
      "The people kept its words beside the bread.",
    ],
  }));
  const pack = {
    id: "greek-drama",
    choices: [],
    recital: {
      title: "The earned account",
      verses,
      sites: siteIds.map((id) => ({ id, at: court, listeners: poets })),
    },
  };
  const authors = [...humanAvatarIds, ...poets].map((id) => ({
    id,
    name: id === "vale" ? "Vale" : id,
  }));
  const catalog = makeReadingCatalog({
    id: "full-card-world/21",
    pack: pack.id,
    title: pack.recital.title,
    verses,
    authors,
  });
  const world = {
    turn: count + 10,
    playerActorId: "vale",
    controlledActors: [...humanAvatarIds],
    presentActors: [...humanAvatarIds],
    actors: Object.fromEntries(
      [...humanAvatarIds, ...poets].map((id) => [id, { place: court }]),
    ),
    packs: {
      [pack.id]: {
        receipts: Object.fromEntries(verses.map((v, i) => [v.choice, i + 1])),
        recitals: Object.fromEntries(
          verses.map((v, i) => [
            v.choice,
            { actor: i % 2 ? null : "vale", visit: null },
          ]),
        ),
      },
    },
  };
  return {
    world,
    pack,
    catalog,
    catalogs: { [catalog.id]: catalog },
    state: emptyPoemReadings(),
  };
}
function start(f, reader = "vale", site = siteIds[0], optional = false) {
  f.world.playerActorId = reader;
  f.world.turn++;
  return beginReading(f.world, f.pack, f.catalog, f.state, {
    site,
    reader,
    optional,
  });
}
function page(f, id, reader = "vale") {
  f.world.playerActorId = reader;
  f.world.turn++;
  return publishReadingPage(f.world, f.state, f.catalogs, id, reader);
}

describe("reading content and exact snapshots", () => {
  it.each(["", "abc", "Io carried a flame. 🕯️", "\ud800", "a".repeat(100000)])(
    "matches the platform digest for input %#",
    (text) => {
      expect(readingDigest(text)).toBe(
        createHash("sha256").update(text).digest("hex"),
      );
      expect(utf8Length(text)).toBe(Buffer.byteLength(text));
    },
  );
  it("freezes the actual cutoff and known or unknown author", () => {
    const f = fixture();
    const id = start(f),
      before = structuredClone(f.state.readings[id]);
    expect(before.through).toBe(before.turn - 1);
    expect(f.state.pins).toEqual({});
    const first = readingPage(f.state, before, f.catalog, 0);
    expect(first[0]).toMatchObject({ authorId: "vale", authorName: "Vale" });
    expect(first[1]).toMatchObject({
      authorId: null,
      authorName: "an earlier traveler",
    });
    f.world.turn += 3;
    expect(f.state.readings[id]).toEqual(before);
    expect(
      validPoemReadings(
        f.world,
        f.pack,
        f.catalogs,
        JSON.parse(JSON.stringify(f.state)),
      ),
    ).toBe(true);
  });
  it("keeps the receipt-order variant rule across later deeds and catalogs", () => {
    const f = fixture(2),
      [base, later] = f.pack.recital.verses;
    base.after = {
      choice: "prior-deed",
      lines: [
        "The earlier deed gave these words weight.",
        "The gate remembered who had come.",
      ],
    };
    later.after = {
      choice: "prior-deed",
      lines: [
        "The message came before this song.",
        "Its earlier hands still held their names.",
      ],
    };
    delete f.world.packs[f.pack.id].receipts[later.choice];
    delete f.world.packs[f.pack.id].recitals[later.choice];
    f.catalog = makeReadingCatalog({
      id: "full-card-world/21",
      pack: f.pack.id,
      title: f.pack.recital.title,
      verses: [base],
      authors: f.catalog.authors,
    });
    f.catalogs = { [f.catalog.id]: f.catalog };
    const firstId = start(f),
      original = structuredClone(f.state.readings[firstId]);
    f.world.packs[f.pack.id].receipts["prior-deed"] = ++f.world.turn;
    const secondId = start(f, "vale", siteIds[0], true);
    expect(
      readingPage(f.state, f.state.readings[secondId], f.catalog, 0)[0].lines,
    ).toEqual(base.lines);
    f.world.packs[f.pack.id].receipts[later.choice] = ++f.world.turn;
    f.world.packs[f.pack.id].recitals[later.choice] = {
      actor: null,
      visit: null,
    };
    f.catalog = makeReadingCatalog({
      id: "full-card-world/22",
      pack: f.pack.id,
      title: f.pack.recital.title,
      verses: [base, later],
      authors: f.catalog.authors,
      previous: f.catalog,
    });
    f.catalogs[f.catalog.id] = f.catalog;
    const thirdId = start(f, "vale", siteIds[0], true);
    const actual = readingPage(
      f.state,
      f.state.readings[thirdId],
      f.catalog,
      0,
    );
    expect(actual.map((s) => s.lines)).toEqual(
      recitalPoem(f.world, f.pack, f.world.turn - 1).stanzas.map(
        (s) => s.lines,
      ),
    );
    expect(actual[1]).toMatchObject({
      lines: later.after.lines,
      authorId: null,
    });
    expect(f.state.readings[firstId]).toEqual(original);
    expect(
      validPoemReadings(
        f.world,
        f.pack,
        f.catalogs,
        JSON.parse(JSON.stringify(f.state)),
      ),
    ).toBe(true);
    f.state = JSON.parse(JSON.stringify(f.state));
    const replay = page(f, firstId);
    expect(replay.readingTurn).toBe(original.turn);
    expect(replay.through).toBe(original.through);
    expect(replay.stanzas.map((s) => s.lines)).toEqual([base.lines]);
  });
  it("requires a new identity for changed published wording", () => {
    const f = fixture();
    const verses = structuredClone(f.pack.recital.verses);
    verses[0].lines[0] = "A changed account needs its own deed.";
    expect(() =>
      makeReadingCatalog({
        id: "full-card-world/22",
        pack: f.pack.id,
        title: f.catalog.title,
        verses,
        authors: f.catalog.authors,
        previous: f.catalog,
      }),
    ).toThrow("new stanza identity");
  });
});

describe("the complete reserved reading envelope", () => {
  it("fits 56 full readings and both tuple variants within 384 KiB", () => {
    const f = fixture(512);
    const base = 9007199254000000;
    f.pack.recital.verses.forEach((verse, i) => {
      if (i < 16) verse.choice = `reading-choice-${i}-`.padEnd(80, "x");
      verse.after = {
        choice: "prior-deed",
        lines: [
          "The earlier message reached the gate.",
          "Its carriers kept their names in song.",
        ],
      };
    });
    f.pack.choices = f.pack.recital.verses.map((verse) => ({
      id: verse.choice,
    }));
    f.world.packs[f.pack.id].receipts = { "prior-deed": 1 };
    f.world.packs[f.pack.id].recitals = {};
    f.pack.recital.verses.forEach((verse, i) => {
      f.world.packs[f.pack.id].receipts[verse.choice] = base - 1024 + i;
      f.world.packs[f.pack.id].recitals[verse.choice] = {
        actor: null,
        visit: null,
      };
    });
    f.catalog = makeReadingCatalog({
      id: "full-card-world/21",
      pack: f.pack.id,
      title: f.pack.recital.title,
      verses: f.pack.recital.verses,
      authors: f.catalog.authors,
    });
    f.catalogs = { [f.catalog.id]: f.catalog };
    for (const variant of [0, 1])
      f.state.stanzas.push(
        ...f.pack.recital.verses.map((verse, i) => [
          i,
          f.world.packs[f.pack.id].receipts[verse.choice],
          null,
          variant,
        ]),
      );
    for (let n = 0; n < 56; n++) {
      const reader = humanAvatarIds[n % 8];
      const site = n < 48 ? siteIds[Math.floor(n / 8)] : siteIds[3];
      f.world.turn = base + n * 1000;
      f.world.playerActorId = reader;
      setReadingDraft(
        f.world,
        f.pack,
        f.state,
        site,
        reader,
        humanAvatarIds.filter((id) => id !== reader),
      );
      const id = beginReading(f.world, f.pack, f.catalog, f.state, {
        site,
        reader,
        optional: n >= 48,
      });
      const reading = f.state.readings[id];
      reading.pages = Array.from({ length: 128 }, (_, i) => [
        f.world.turn + i + 1,
        1023,
        1023,
      ]);
      reading.complete = true;
      f.state.pins[site] ??= id;
    }
    for (const [i, choice] of f.pack.choices.slice(0, 16).entries())
      f.state.decisions[choice.id] = Object.keys(f.state.readings)[i];
    f.world.turn = base + 60000;
    for (const reader of humanAvatarIds) {
      f.world.playerActorId = reader;
      setReadingDraft(
        f.world,
        f.pack,
        f.state,
        siteIds[3],
        reader,
        humanAvatarIds.filter((id) => id !== reader),
      );
    }
    expect(f.state.stanzas).toHaveLength(1024);
    expect(Object.values(f.state.readings)).toHaveLength(56);
    expect(
      Object.values(f.state.readings).every(
        (read) => read.selection.length === 512 && read.pages.length === 128,
      ),
    ).toBe(true);
    const bytes = readingBlockBytes(f.state);
    console.info(
      `Full reading archive: ${bytes} / ${readingLimits.bytes} bytes.`,
    );
    expect(bytes).toBeLessThanOrEqual(readingLimits.bytes);
    expect(validPoemReadings(f.world, f.pack, f.catalogs, f.state)).toBe(true);
    expect(
      validPoemReadings(
        f.world,
        f.pack,
        f.catalogs,
        JSON.parse(JSON.stringify(f.state)),
      ),
    ).toBe(true);
  });
});

describe("required hearings and private guests", () => {
  it("pins the first complete reading after the final required page", () => {
    const f = fixture(),
      id = start(f);
    expect(page(f, id).firstCompletion).toBe(false);
    expect(f.state.readings[id].complete).toBe(false);
    expect(f.state.pins).toEqual({});
    f.world.actors[poets[1]].place = "elsewhere";
    const before = JSON.stringify(f.state);
    expect(() => page(f, id)).toThrow("required listeners");
    expect(JSON.stringify(f.state)).toBe(before);
    f.world.actors[poets[1]].place = court;
    expect(page(f, id).firstCompletion).toBe(true);
    expect(f.state.pins[siteIds[0]]).toBe(id);
    expect(validPoemReadings(f.world, f.pack, f.catalogs, f.state)).toBe(true);
  });
  it("keeps reserved starts available after optional reads and an abandoned first reader", () => {
    const f = fixture(),
      first = start(f);
    page(f, first);
    const original = structuredClone(f.state.readings[first]);
    for (let i = 0; i < readingLimits.optional; i++)
      start(f, "vale", siteIds[0], true);
    expect(() => start(f, "vale", siteIds[0], true)).toThrow("Replay");
    f.world.actors.vale.place = "elsewhere";
    const second = start(f, "mara");
    page(f, second, "mara");
    expect(page(f, second, "mara").firstCompletion).toBe(true);
    expect(f.state.pins[siteIds[0]]).toBe(second);
    expect(f.state.readings[first]).toEqual(original);
    expect(
      heardReadingPages(f.state, f.catalogs, "mara").map((read) => read.id),
    ).toEqual([second]);
    expect(validPoemReadings(f.world, f.pack, f.catalogs, f.state)).toBe(true);
  });
  it("keeps missed private pages for an authorized replay after a guest returns", () => {
    const f = fixture(10);
    setReadingDraft(f.world, f.pack, f.state, siteIds[0], "vale", ["mara"]);
    const id = start(f),
      original = structuredClone(f.state.readings[id]);
    page(f, id);
    f.world.actors.mara.place = "elsewhere";
    page(f, id);
    f.world.actors.mara.place = court;
    page(f, id);
    expect(
      heardReadingPages(f.state, f.catalogs, "mara")[0].pages.map(
        (p) => p.index,
      ),
    ).toEqual([0]);
    f.world.playerActorId = "ash";
    expect(sharedHeardPages(f.world, f.state, f.catalogs, poets[0])).toEqual(
      [],
    );
    f.world.playerActorId = "vale";
    expect(sharedHeardPages(f.world, f.state, f.catalogs, poets[0])).toEqual(
      [],
    );
    for (const actor of humanAvatarIds.filter(
      (id) => !["vale", "mara"].includes(id),
    ))
      f.world.actors[actor].place = "elsewhere";
    expect(
      sharedHeardPages(f.world, f.state, f.catalogs, poets[0])[0].pages.map(
        (p) => p.index,
      ),
    ).toEqual([0]);
    const firstPublication = [...f.state.readings[id].pages[1]];
    for (const index of [1, 2]) {
      f.world.turn++;
      const packet = replayReadingPage(
        f.world,
        f.state,
        f.catalogs,
        id,
        "vale",
        index,
        "mara",
      );
      expect(packet.readingTurn).toBe(original.turn);
      expect(packet.through).toBe(original.through);
    }
    expect(f.state.readings[id].pages[1].slice(0, 2)).toEqual(
      firstPublication.slice(0, 2),
    );
    expect(heardReadingPages(f.state, f.catalogs, "mara")[0].heardAll).toBe(
      true,
    );
    expect(heardReadingPages(f.state, f.catalogs, "ash")).toEqual([]);
    expect(() =>
      replayReadingPage(f.world, f.state, f.catalogs, id, "vale", 0, "ash"),
    ).toThrow("original listener");
    expect(
      validPoemReadings(
        f.world,
        f.pack,
        f.catalogs,
        JSON.parse(JSON.stringify(f.state)),
      ),
    ).toBe(true);
  });
  it("replaces an unstarted draft and rejects a changed start audience", () => {
    const f = fixture();
    setReadingDraft(f.world, f.pack, f.state, siteIds[0], "vale", ["mara"]);
    setReadingDraft(f.world, f.pack, f.state, siteIds[1], "vale", ["ash"]);
    expect(Object.keys(f.state.drafts)).toEqual(["vale"]);
    expect(f.state.drafts.vale.site).toBe(siteIds[1]);
    f.world.actors.ash.place = "elsewhere";
    const before = JSON.stringify(f.state);
    expect(() => start(f, "vale", siteIds[1])).toThrow("present audience");
    expect(JSON.stringify(f.state)).toBe(before);
  });
  it("keeps malformed snapshot selections and forged page completion outside valid saves", () => {
    const f = fixture(),
      id = start(f);
    const bad = structuredClone(f.state);
    bad.readings[id].through++;
    expect(validPoemReadings(f.world, f.pack, f.catalogs, bad)).toBe(false);
    const forged = structuredClone(f.state);
    forged.readings[id].complete = true;
    expect(validPoemReadings(f.world, f.pack, f.catalogs, forged)).toBe(false);
  });
});
