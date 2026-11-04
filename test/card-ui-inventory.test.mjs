import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as ui from "../scripts/check-ui-inventory.mjs";

const { INVENTORY, ROOT, compare, inventoryOf, scanTree, styleRules } = ui;

const scan = (files) => scanTree(Object.keys(files), (file) => files[file]);
const base = {
  "a.css": ".card { color: red }\n#hand .card { margin: 0 }",
  "a.mjs":
    'const el = node("div", "", "card");\nfunction node(tag, text, className) {\n  const n = document.createElement(tag);\n  n.className = className;\n  return n;\n}',
  "index.html": '<body><main id="hand" class="hand"></main></body>',
};
const approved = inventoryOf(scan(base));
const check = (files) => compare(scan({ ...base, ...files }), approved);

describe("UI inventory guard", () => {
  it("passes the current tree", () => {
    const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
    const tree = scanTree(ui.uiFiles(), read);
    expect(compare(tree, JSON.parse(read(INVENTORY))).errors).toEqual([]);
  });

  it("flags a new class, id or element with its file and line", () => {
    const css = check({
      "a.css": `${base["a.css"]}\n.quest-drop-panel { inset: 0 }`,
    });
    expect(css.errors[0]).toBe(
      'New UI element class "quest-drop-panel" in a.css:3 is not in the approved UI inventory.',
    );
    expect(css.errors.at(-1)).toMatch(/see AGENTS\.md/);
    const html = '<body><main id="hand"></main><b id="drop"></b></body>';
    expect(check({ "index.html": html }).errors[0]).toContain(
      '"drop" in index',
    );
    const js = `${base["a.mjs"]}\nnode("div", "Drop", "card");`;
    expect(check({ "a.mjs": js }).errors[0]).toMatch(/creates 3 .* allows 2/);
  });

  it("lets state, colour and text variants through", () => {
    const result = check({
      "a.css": `${base["a.css"]}
.card.glowing, body.resting .card { color: var(--gold) }
.card[data-state="dropped"]:not(.departed)::after { content: "x" }
#hand > .card:is(.ready, .waking) { opacity: 0.5 }`,
      "a.mjs":
        base["a.mjs"].replace('"", "card"', '"Abandon", "card"') +
        '\nel.classList.add("chosen");',
    });
    expect(result.errors).toEqual([]);
    const gone = { ...approved, classes: [...approved.classes, "gone"] };
    expect(compare(scan(base), gone).notes[0]).toContain("gone");
  });

  // The #2206 Drop restyle (af28bc3cf): restyled #card-actions and its panel
  // through [data-*] and :has() without a new name.
  it("flags a restyle of a core surface but not a reformat", () => {
    const surfaces = ["#card-actions", ".action-*", ".card"];
    const css = `#card-actions button { color: #f2e3c4 }
.stage .glow { color: red }
@media (width < 600px) { .card .name { font-size: 12px; color: red } }`;
    const rules = (text) => styleRules("style.css", text, surfaces);
    const snapshot = { rules: [...rules(css).keys()] };
    expect(snapshot.rules).toHaveLength(2);
    const reformat = rules(css.replace("12px; ", "12px;\n  "));
    expect(ui.compareStyles(reformat, snapshot)).toEqual([]);
    const drop = `${css}
body #card-actions button[data-destructive] { color: var(--danger) }
.beat-stack > .action-panel:has(> #card-actions > [data-destructive]) { border: 0 }`;
    const errors = ui.compareStyles(rules(drop), snapshot);
    expect(errors[0]).toMatch(/css:4: body #card-actions button\[data-/);
    expect(errors[1]).toMatch(/style\.css:5: \.beat-stack>\.action-panel:has/);
    const recolour = rules(css.replace("#f2e3c4", "red"));
    expect(ui.compareStyles(recolour, snapshot)).toHaveLength(3);
  });

  it("guards variables across files, chains, fallbacks and media overrides", () => {
    const files = {
      "cards.css":
        ".card { height: var(--height, var(--fallback)); color: var(--ink) }",
      "theme.css": `:root { --height: calc(var(--unit) * 3); --unit: 20px; --fallback: 40px; --ink: red; --other: 10px }
@media (width < 600px) { body { --unit: 15px } }`,
    };
    const rules = (theme) =>
      ui.styleTree(
        Object.keys(files),
        (f) => (f === "theme.css" ? theme : files[f]),
        [".card"],
      );
    const snapshot = { rules: [...rules(files["theme.css"]).keys()] };
    for (const [from, to] of [
      ["20px", "1px"],
      ["15px", "2px"],
      ["40px", "3px"],
      ["--ink: red;", ""],
    ])
      expect(
        ui.compareStyles(rules(files["theme.css"].replace(from, to)), snapshot)
          .length,
      ).toBeGreaterThan(0);
    expect(
      ui.compareStyles(
        rules(`${files["theme.css"]}\nbody { --height: 1px }`),
        snapshot,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      ui.compareStyles(
        rules(files["theme.css"].replace("10px", "11px")),
        snapshot,
      ),
    ).toEqual([]);
  });

  it("flags a card height change in the shipping root variables", () => {
    const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
    const snapshot = JSON.parse(read(ui.STYLES));
    const files = ui.uiFiles();
    expect(
      ui.compareStyles(ui.styleTree(files, read, snapshot.surfaces), snapshot),
    ).toEqual([]);
    const changed = (file) =>
      file === "v2/card-game/style.css"
        ? read(file).replace(/--card-height:\s*[^;]+;/, "--card-height: 1px;")
        : read(file);
    const result = ui.compareStyles(
      ui.styleTree(files, changed, snapshot.surfaces),
      snapshot,
    );
    expect(result.join("\n")).toContain(":root { --card-height: 1px;");
  });
});
