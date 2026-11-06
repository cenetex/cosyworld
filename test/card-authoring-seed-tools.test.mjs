import { expect, it, vi } from "vitest";
import { authoringSeedTools } from "../v2/card-game/authoring-seed-tools.mjs";
const card = (id, name) => ({ id, name, specialAbility: "The Lightkeeper",
  description: "A patient traveller.", aliases: [], suggested: true });
function setup(options = {}) {
  let text = "", value = { mode: "extract", cards: [], selected: [], busy: false,
    completed: 0, error: "" };
  const draw = {
    get text() { return text; }, get state() { return structuredClone(value); },
    setMode(mode) { value.mode = mode; }, setText(next) { text = next; },
    select(id) { value.selected = value.selected.includes(id) ? value.selected.filter(x => x !== id) : [...value.selected, id]; },
    find: vi.fn(async () => {}), cancel: vi.fn(() => { value.busy = false; }),
    clear() { text = ""; value.cards = []; value.selected = []; value.busy = false; },
    remove: vi.fn(ids => { value.cards = value.cards.filter(c => !ids.includes(c.id)); value.selected = value.selected.filter(id => !ids.includes(id)); }),
  };
  const record = { key: "first", generation: 0,
    draft: { document: "Saved notes", sources: [], pack: { id: "test", avatars: {} } },
    launch: null, assets: new Map() };
  const prepare = vi.fn(async current => ({ baseline: JSON.stringify([
    current.key, current.generation, current.draft, current.launch]), bytes: new Map() }));
  const ctx = { snapshot: vi.fn(() => structuredClone(record)), accept: vi.fn(async () => record) };
  const chooseTool = vi.fn(), api = authoringSeedTools({ createDraw: () => draw,
    prepare, chooseTool, readNames: async () => [{ name: "Vale", aliases: ["Light"] }], ...options });
  api.open({ key: record.key });
  return { api, draw, record, ctx, prepare, chooseTool, value,
    tool: id => api.tools().find(tool => tool.id === id) };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
it("keeps selected outputs only after one save and retries the same prepared bytes", async () => {
  const s = setup();
  s.tool("seed").describe().edit.onInput("SECRET world seed");
  s.value.cards = [card("one", "Lumi"), card("two", "Pip")];
  for (const id of ["one", "two"]) s.tool(`seed-${id}`).select();
  expect(s.api.transientState()).not.toContain("SECRET");
  s.ctx.accept.mockRejectedValueOnce(new Error("Storage full"));
  await s.tool("seed-one").run({ run: "keep" }, s.ctx);
  expect(s.draw.remove).not.toHaveBeenCalled();
  expect(s.tool("seed-one").describe().actions[0].label).toBe("Retry save");
  await s.tool("seed-one").run({ run: "keep" }, s.ctx);
  expect(s.prepare).toHaveBeenCalledTimes(1);
  expect(s.ctx.accept.mock.calls[1][0]).toBe(s.ctx.accept.mock.calls[0][0]);
  expect(s.draw.remove).toHaveBeenCalledWith(["one", "two"]);
  expect(s.draw.text).toBe("SECRET world seed");
  const requests = s.prepare.mock.calls[0][1];
  expect(requests.map(r => r.accepted.name)).toEqual(["Lumi", "Pip"]);
  expect(JSON.stringify(requests)).not.toContain("SECRET");
  expect(requests[0].accepted.suggested).toBe(true);
});
it("cancels metadata lookup and discards late work when another draft opens", async () => {
  const wait = Promise.withResolvers(), s = setup({ readNames: () => wait.promise });
  s.tool("seed").describe().edit.onInput("Old source");
  expect(s.tool("seed").run({ run: "find" }, s.ctx)).toBeUndefined();
  expect(s.ctx.snapshot).toHaveBeenCalledWith({assets:true});
  expect(s.tool("seed").describe().actions[0].label).toBe("Cancel draw");
  s.tool("seed").run({ run: "cancel" }, s.ctx);
  expect(s.draw.cancel).toHaveBeenCalled();
  const oldInput = s.tool("seed").describe().edit.onInput;
  s.api.open({ key: "second" }); oldInput("Late old input"); wait.resolve([]); await tick();
  expect(s.draw.find).not.toHaveBeenCalled();
  expect(s.draw.text).toBe("");
  expect(s.draw.state.mode).toBe("idea");
});
it("drops a prepared batch after a draft switch and keeps the new seed clear", async () => {
  const wait = Promise.withResolvers(), s = setup({ prepare: () => wait.promise });
  s.value.cards = [card("one", "Lumi")]; s.tool("seed-one").select();
  const saving = s.tool("seed-one").run({ run: "keep" }, s.ctx);
  s.api.open({ key: "second" });
  wait.resolve({ baseline: "old", bytes: new Map() }); await saving;
  expect(s.ctx.accept).not.toHaveBeenCalled();
  expect(s.tool("seed").describe().edit.value).toBe("");
});
it("rechecks current cast names and aliases before Keep and preserves the other proposals", async () => {
  const s = setup({ readNames: async record => Object.values(record.draft.pack.avatars) });
  s.value.cards = [card("one", "Lumi"), card("two", "Pip")]; s.tool("seed-one").select();
  s.record.draft.pack.avatars.dino = { name: "Dino", aliases: ["Lúmi"] };
  await s.tool("seed-one").run({run:"keep"}, s.ctx);
  expect(s.prepare).not.toHaveBeenCalled(); expect(s.ctx.accept).not.toHaveBeenCalled();
  expect(s.tool("seed-one").describe().note).toContain("open World seed and choose Find more");
  s.tool("seed-one").select(); s.tool("seed-two").select();
  await s.tool("seed-two").run({run:"keep"}, s.ctx);
  expect(s.prepare.mock.calls[0][1].map(request => request.accepted.name)).toEqual(["Pip"]);
  expect(s.value.cards.map(card => card.name)).toEqual(["Lumi"]);
});
