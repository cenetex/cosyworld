import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as ui from "../scripts/check-ui-inventory.mjs";

const { INVENTORY, ROOT, compare, inventoryOf, prune, scanTree } = ui;

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
    expect(css.ok).toBe(false);
    expect(css.errors[0]).toBe(
      'New UI element class "quest-drop-panel" in a.css:3 is not in the approved UI inventory.',
    );
    expect(css.errors.at(-1)).toMatch(/see AGENTS\.md/);
    const html = check({
      "index.html": '<body><main id="hand"></main><div id="drop"></div></body>',
    });
    expect(html.errors[0]).toContain('id "drop" in index.html:1');
    const js = check({
      "a.mjs": `${base["a.mjs"]}\nconst panel = node("div", "Drop", "card");`,
    });
    expect(js.errors[0]).toMatch(/a\.mjs: it creates 3 elements .* allows 2/);
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
  });

  it("notes removals and prunes without approving anything", () => {
    const tree = scan({ ...base, "a.css": ".card {}" });
    const stale = { ...approved, classes: [...approved.classes, "gone"] };
    const result = compare(tree, stale);
    expect(result.ok).toBe(true);
    expect(result.notes[0]).toContain("gone");
    const next = prune(tree, stale);
    expect(next.classes).toEqual(approved.classes);
    expect(next.elements).toEqual(approved.elements);
  });
});
