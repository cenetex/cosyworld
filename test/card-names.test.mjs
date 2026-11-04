import { afterEach, describe, expect, it } from "vitest";
import {
  cardNameRuns,
  nameLetters,
  namedText,
} from "../v2/card-game/card-names.mjs";
import {
  createRevealPainter,
  createTextReveal,
  splitLetters,
} from "../v2/card-game/dialogue.mjs";
import { tiers } from "../v2/card-game/level-tiers.mjs";

const card = (id, name, person = false, color = "#c8dce6") => ({
  id,
  name,
  person,
  color,
});
const scene = [
  card("moth", "Pip", true),
  card("lamp", "Lamp", false, "#fff082"),
  card("station", "Empty station"),
  card("keeper", "The keeper", true),
  card("ash", "Ash", true),
  card("sage", "Sage", true),
  card("oak", "Oak", true),
];
const named = (text, cards = scene) =>
  cardNameRuns(text, cards).map(({ start, end }) => text.slice(start, end));

describe("card names in text", () => {
  it("finds the scene's cards by whole, exact name", () => {
    expect(named("Pip took the Lamp to Empty station.")).toEqual([
      "Pip",
      "Lamp",
      "Empty station",
    ]);
    // Things and places in any case; the article stays plain.
    expect(named("the lamp is lit at the empty station")).toEqual([
      "lamp",
      "empty station",
    ]);
    // A person's name as written, and a name with its own article.
    expect(named("The keeper nods; the keeper's lamp")).toEqual([
      "keeper",
      "keeper",
      "lamp",
    ]);
    expect(named("Pip's lamp")).toEqual(["Pip", "lamp"]);
  });
  it("never lights common words, parts of words or other scenes", () => {
    // Avatars named Ash, Sage and Oak leave the words alone.
    expect(named("ash on the oak, a sage word")).toEqual([]);
    expect(named("Ash and Sage sat under Oak.")).toEqual([
      "Ash",
      "Sage",
      "Oak",
    ]);
    expect(named("Pipe smoke and lamplight; a lampshade")).toEqual([]);
    expect(named("pip")).toEqual([]);
    // Only the scene's cards: Vale is not in this one.
    expect(named("Vale took the Lamp.", [scene[1]])).toEqual(["Lamp"]);
    expect(named("Pip", [])).toEqual([]);
  });
  it("prefers the earlier, then the longer, name", () => {
    const cards = [card("pond", "Pond"), card("black", "Black pond")];
    expect(named("the Black pond, the pond", cards)).toEqual([
      "Black pond",
      "pond",
    ]);
  });
  it("counts letters as the reveal does", () => {
    const text = "Héllo 👋🏽 Pip, the Lamp";
    const letters = splitLetters(text);
    for (const run of cardNameRuns(text, scene))
      expect(letters.slice(run.from, run.to).join("")).toBe(
        text.slice(run.start, run.end),
      );
  });
  it("keeps every name readable on the dark table", () => {
    const luminance = (hex) => {
      const [r, g, b] = hex
        .match(/[0-9a-f]{2}/giu)
        .map((part) => parseInt(part, 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // The beat card's ground and the loss screen's black.
    for (const ground of ["#10151d", "#000000"])
      for (const { color } of tiers)
        expect(
          (luminance(color) + 0.05) / (luminance(ground) + 0.05),
        ).toBeGreaterThanOrEqual(4.5);
  });
});

// Just enough DOM for the reveal's painter and the name runs.
class Node {
  constructor(text = "") {
    this.children = [];
    this.parent = null;
    this.text = text;
    this.dataset = {};
    this.classes = new Set();
    this.style = { setProperty: (key, value) => (this.style[key] = value) };
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
    };
  }
  get textContent() {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(text) {
    this.text = text;
  }
  append(...nodes) {
    for (const child of nodes) {
      child.parent?.children.splice(child.parent.children.indexOf(child), 1);
      child.parent = this;
      this.children.push(child);
    }
  }
  before(node) {
    const siblings = this.parent.children;
    node.parent = this.parent;
    siblings.splice(siblings.indexOf(this), 0, node);
  }
  replaceWith(text) {
    this.parent.children[this.parent.children.indexOf(this)] = new Node(text);
  }
  normalize() {}
}
afterEach(() => delete globalThis.document);

describe("named letters in the reveal", () => {
  it("wraps the reveal's own letters without changing its timing", () => {
    globalThis.document = { createElement: () => new Node() };
    const text = "Pip lifts the Lamp.";
    const root = new Node();
    const glyphs = splitLetters(text).map((letter) => new Node(letter));
    root.append(...glyphs);
    nameLetters(glyphs, text, scene);
    // The runs hold exactly the named letters, in the card's colour.
    const runs = root.children.filter((n) => n.style["--tier-color"]);
    expect(runs.map((run) => run.textContent)).toEqual(["Pip", "Lamp"]);
    expect(runs[1].style["--tier-color"]).toBe("#fff082");
    expect(root.textContent).toBe(text);
    // The reveal still writes one letter at a time across the runs, with
    // its caret on the newest letter.
    const painter = createRevealPainter(root);
    painter.start(glyphs);
    let clock = 0;
    const frames = [];
    const pen = createTextReveal({
      now: () => clock,
      requestFrame: null,
      frame: (value) => {
        painter.paint(value);
        frames.push(value.shown);
      },
    });
    pen.show("line", text, null);
    expect(glyphs[0].classes.has("cursor")).toBe(false);
    pen.finish();
    expect(frames.at(-1)).toBe(glyphs.length);
    expect(glyphs.every((glyph) => glyph.classes.has("revealed"))).toBe(true);
    pen.cancel();
  });
  it("writes whole text with the same runs", () => {
    globalThis.document = { createElement: () => new Node() };
    const nodes = namedText("You dropped the Lamp.", scene);
    expect(
      nodes.map((n) => (typeof n === "string" ? n : n.textContent)),
    ).toEqual(["You dropped the ", "Lamp", "."]);
  });
});
