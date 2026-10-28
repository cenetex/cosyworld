import { describe, expect, it } from "vitest";
import { compileReadingCatalogs } from "../v2/scripts/card-reading-catalogs.mjs";
import { readingDigest } from "../v2/card-game/reading-digest.mjs";

const pack = () => ({
  id: "greek-drama",
  avatars: { poet: { name: "The poet" } },
  recital: {
    title: "An earned account",
    verses: [
      {
        choice: "first-deed",
        lines: ["I took the message home.", "Its keeper knew my name."],
      },
    ],
  },
});
const active = (compiled) => {
  const history = compiled.packs["greek-drama"];
  return history.catalogs[history.current];
};
describe("published reading catalogs", () => {
  it("keeps the old catalog exact when the next rules add a stanza and author", () => {
    const source = pack();
    const first = compileReadingCatalogs([source], "full-card-world/21");
    const old = active(first);
    const saved = JSON.stringify(old);
    source.avatars.newPoet = { name: "A later poet" };
    source.recital.verses.push({
      choice: "second-deed",
      lines: [
        "The later carrier arrived.",
        "The earlier voice kept its place.",
      ],
    });
    const next = compileReadingCatalogs(
      [source],
      "full-card-world/22",
      JSON.parse(JSON.stringify(first)),
    );
    expect(JSON.stringify(next.packs[source.id].catalogs[old.id])).toBe(saved);
    const current = active(next);
    expect(current.rows[0]).toEqual(old.rows[0]);
    expect(current.authors.slice(0, -1)).toEqual(old.authors);
    expect(current.authors.at(-1)).toEqual({
      id: "newPoet",
      name: "A later poet",
    });
    const { digest, ...body } = current;
    expect(digest).toBe(readingDigest(JSON.stringify(body)));
  });
  it("requires a fresh stanza identity for changed published wording", () => {
    const source = pack();
    const first = compileReadingCatalogs([source], "full-card-world/21");
    source.recital.verses[0].lines[0] = "The changed line needs its own deed.";
    expect(() =>
      compileReadingCatalogs([source], "full-card-world/22", first),
    ).toThrow("new stanza identity");
  });
  it("keeps earlier printed author names while the next catalog records a new name", () => {
    const source = pack();
    const first = compileReadingCatalogs([source], "full-card-world/21");
    source.avatars.poet.name = "The poet at home";
    const next = compileReadingCatalogs([source], "full-card-world/22", first);
    expect(
      next.packs[source.id].catalogs[active(first).id].authors.at(-1).name,
    ).toBe("The poet");
    expect(active(next).authors.at(-1).name).toBe("The poet at home");
  });
  it("retains a saved catalog when more draft deeds join the same rules", () => {
    const source = pack();
    const first = compileReadingCatalogs([source], "full-card-world/21");
    const old = active(first);
    source.recital.verses.push({
      choice: "later-deed",
      lines: ["A later carrier arrived.", "The first account stayed whole."],
    });
    const next = compileReadingCatalogs([source], "full-card-world/21", first);
    expect(active(next).id).not.toBe(old.id);
    expect(next.packs[source.id].catalogs[old.id]).toEqual(old);
    expect(
      compileReadingCatalogs([source], "full-card-world/21", next),
    ).toEqual(next);
  });
});
