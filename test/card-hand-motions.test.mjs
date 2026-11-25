import { it } from "vitest";
import assert from "node:assert/strict";
import { createHandMotions, TRAVEL_EASE, TRAVEL_MS, travelFrames } from "../v2/card-game/card-travel.mjs";

const frames = travelFrames({ left: 200, top: 30 }, { left: 50, top: 50 });
function card(holder = "vale") {
  return {
    dataset: { holder }, parentElement: {}, isConnected: true, hidden: false, animations: [],
    animate(keyframes, options) {
      let resolve, reject;
      const motion = {
        keyframes, options, playState: "running", currentTime: 120, cancelled: 0,
        finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
        cancel() { this.playState = "idle"; this.cancelled++; reject(new Error("Cancelled")); },
        finish() { this.playState = "finished"; resolve(); },
      };
      this.animations.push(motion);
      return motion;
    },
  };
}
const fly = (motions, element) =>
  motions.move("frame:lamp", element, frames, TRAVEL_MS, 0, TRAVEL_EASE, true);

it("keeps the same handover through cosmetic redraws and later layout requests", () => {
  const motions = createHandMotions(), element = card(), flight = fly(motions, element);
  motions.redraw(true);
  motions.reconcile();
  const layout = motions.move("frame:lamp", element, { translate: ["10px 0", "0 0"] });
  assert.equal(layout, flight);
  assert.equal(element.animations.length, 1);
  assert.equal(flight.playState, "running");
  assert.equal(flight.cancelled, 0);
  assert.equal(flight.currentTime, 120);
  assert.equal(flight.options.duration, TRAVEL_MS);
});

for (const [reason, change] of [
  ["new holder", (frame) => { frame.dataset.holder = "moth"; }],
  ["removed frame", (frame) => { frame.isConnected = false; }],
  ["different parent", (frame) => { frame.parentElement = {}; }],
  ["folded frame", (frame) => { frame.hidden = true; }],
]) it(`cancels a flight after reconciliation reveals a ${reason}`, () => {
  const motions = createHandMotions(), element = card(), flight = fly(motions, element);
  motions.redraw(true);
  change(element);
  motions.reconcile();
  assert.equal(flight.playState, "idle");
  assert.deepEqual(motions.values(), []);
});

it("starts a real second handover and keeps it when the cancelled promise settles", async () => {
  const motions = createHandMotions(), oldFrame = card(), first = fly(motions, oldFrame);
  motions.redraw(true);
  oldFrame.isConnected = false;
  motions.reconcile();
  const nextFrame = card("moth"), second = fly(motions, nextFrame);
  await Promise.resolve();
  assert.equal(first.cancelled, 1);
  assert.notEqual(first, second);
  assert.equal(second.playState, "running");
  assert.deepEqual(motions.values(), [second]);
  second.finish();
  await Promise.resolve();
  assert.deepEqual(motions.values(), []);
});

it("cleans up a finished reference without changing it to cancelled", () => {
  const motions = createHandMotions(), element = card(), flight = fly(motions, element);
  for (const motion of motions.values()) motion.finish();
  motions.redraw(false);
  assert.equal(flight.playState, "finished");
  assert.equal(flight.cancelled, 0);
  assert.deepEqual(motions.values(), []);
});

it("cancels ordinary layout on redraw and flights when the scene no longer keeps them", () => {
  const motions = createHandMotions(), element = card();
  const layout = motions.move("frame:lamp", element, { translate: ["10px 0", "0 0"] });
  motions.redraw(true);
  assert.equal(layout.cancelled, 1);
  const flight = fly(motions, element);
  motions.redraw(false);
  assert.equal(flight.cancelled, 1);
  assert.deepEqual(motions.values(), []);
});
