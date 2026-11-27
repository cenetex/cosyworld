import { afterEach, expect, it, vi } from "vitest";
import { crossfadeImage, fadeLayer } from "../v2/card-game/transitions.mjs";

afterEach(() => vi.unstubAllGlobals());

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function layer(hidden = true) {
  const decodes = [],
    motions = [];
  const el = {
    hidden,
    style: { opacity: "" },
    decode: vi.fn(() => {
      const task = deferred();
      decodes.push(task);
      return task.promise;
    }),
    animate: vi.fn(() => {
      const done = deferred();
      const motion = {
        finished: done.promise,
        finish: done.resolve,
        cancel: vi.fn(),
      };
      motions.push(motion);
      return motion;
    }),
  };
  return { el, decodes, motions };
}

function backdrop() {
  vi.stubGlobal("getComputedStyle", () => ({ filter: "none", objectPosition: "center" }));
  const { el: img, decodes } = layer(false);
  const { el: ghost, motions } = layer(false);
  Object.assign(img, {
    src: "daylight",
    complete: true,
    naturalWidth: 1,
    getAttribute: () => img.src,
    cloneNode: vi.fn(() => ghost),
    after: () => { ghost.isConnected = true; },
  });
  Object.assign(ghost, {
    classList: { add() {} },
    setAttribute() {},
    removeAttribute: vi.fn(),
    remove: () => { ghost.isConnected = false; },
  });
  return { img, ghost, decodes, motions };
}

it.each(["night", "station"])("drops the outgoing painting when an instant cut selects %s", async (source) => {
  const { img, ghost, decodes } = backdrop();
  crossfadeImage(img, "night");
  expect(ghost.isConnected).toBe(true);
  crossfadeImage(img, source, { duration: 0 });
  expect(ghost.isConnected).toBe(false);
  expect(ghost.removeAttribute).toHaveBeenCalledWith("src");
  expect(img.src).toBe(source);
  decodes[0].resolve();
  await settle();
  expect(ghost.animate).not.toHaveBeenCalled();
});

it("keeps the outgoing painting until the newest replacement decodes", async () => {
  const { img, ghost, decodes, motions } = backdrop();
  crossfadeImage(img, "night");
  img.complete = false;
  crossfadeImage(img, "lamplit");
  decodes[0].reject(new Error("Replaced while decoding"));
  await settle();
  expect(ghost.isConnected).toBe(true);
  expect(ghost.animate).not.toHaveBeenCalled();
  expect(img.cloneNode).toHaveBeenCalledOnce();
  decodes[1].resolve();
  await settle();
  expect(ghost.animate).toHaveBeenCalledOnce();
  motions[0].finish();
  await vi.waitFor(() => expect(ghost.isConnected).toBe(false));
});

it("ignores an old decode after show, immediate hide, and show again", async () => {
  const { el, decodes } = layer();
  fadeLayer(el, true);
  fadeLayer(el, false, { duration: 0 });
  fadeLayer(el, true);
  decodes[1].resolve();
  await settle();
  expect(el.animate).toHaveBeenCalledTimes(1);
  decodes[0].resolve();
  await settle();
  expect(el.animate).toHaveBeenCalledTimes(1);
  expect(el.hidden).toBe(false);
});

it("does not let a completed old hide hide a newer show", async () => {
  const { el, motions } = layer(false);
  fadeLayer(el, false);
  await settle();
  motions[0].finish();
  fadeLayer(el, true, { duration: 0 });
  await settle();
  expect(el.hidden).toBe(false);
  expect(el.style.opacity).toBe("");
});

it("keeps immediate hide authoritative over a pending show", async () => {
  const { el, decodes } = layer();
  fadeLayer(el, true);
  fadeLayer(el, false, { duration: 0 });
  decodes[0].resolve();
  await settle();
  expect(el.hidden).toBe(true);
  expect(el.animate).not.toHaveBeenCalled();
});

it("settles an animated hide immediately when travel also asks to hide", async () => {
  const { el, motions } = layer(false);
  const scenery = { cancel: vi.fn() };
  el.getAnimations = () => [scenery, ...motions];
  fadeLayer(el, false);
  await settle();
  fadeLayer(el, false, { duration: 0 });
  expect(el.hidden).toBe(true);
  expect(motions[0].cancel).toHaveBeenCalledOnce();
  expect(scenery.cancel).not.toHaveBeenCalled();
});

it("settles a pending show immediately without letting its decode animate later", async () => {
  const { el, decodes } = layer();
  fadeLayer(el, true);
  fadeLayer(el, true, { duration: 0 });
  expect(el.hidden).toBe(false);
  expect(el.style.opacity).toBe("");
  decodes[0].resolve();
  await settle();
  expect(el.animate).not.toHaveBeenCalled();
});

it("does not restart repeated requests and finishes the current hide", async () => {
  const { el, decodes, motions } = layer();
  fadeLayer(el, true);
  fadeLayer(el, true);
  expect(el.decode).toHaveBeenCalledTimes(1);
  decodes[0].reject(new Error("Image unavailable"));
  await settle();
  expect(el.animate).toHaveBeenCalledTimes(1);
  fadeLayer(el, false);
  await settle();
  expect(motions[0].cancel).toHaveBeenCalledOnce();
  motions[1].finish();
  await settle();
  expect(el.hidden).toBe(true);
});
