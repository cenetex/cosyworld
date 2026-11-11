import { expect, it, vi } from "vitest";
import { fadeLayer } from "../v2/card-game/transitions.mjs";

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
    getAnimations: () =>
      motions.filter((motion) => !motion.cancel.mock.calls.length),
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
