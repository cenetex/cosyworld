import { expect, it, vi } from "vitest";
import { createAuthoringVisualDraft } from "../v2/card-game/authoring-visual-draft.mjs";
import { POSE_ROLES } from "../v2/card-game/authoring-images.mjs";
const image = (letter) => ({
  mime: "image/png",
  bytes: Uint8Array.of(1),
  size: 1,
  sha256: letter.repeat(64),
});
const design = {
  id: "sample-vale_awake",
  kind: "avatar",
  revision: 1,
  description: "A bright dinosaur.",
  base: image("a"),
};
const reference = async ({ sha256 }) => ({ sha256 });
const deferred = () => {
  let resolve;
  return {
    promise: new Promise((done) => {
      resolve = done;
    }),
    resolve,
  };
};

it("cancels before a paid request or after a late reply and preserves the open design", async () => {
  const ref = deferred(),
    response = deferred(),
    request = vi.fn(() => response.promise);
  const review = createAuthoringVisualDraft({
    request,
    reference: () => ref.promise,
  });
  review.open(design);
  review.describe("");
  expect(review.state.described).toBe(false);
  await expect(review.roll()).rejects.toThrow(/1200 characters/);
  review.describe(design.description);
  const preparing = review.roll("portrait", "Add a scarf.");
  review.cancel();
  ref.resolve({ sha256: design.base.sha256 });
  await preparing;
  expect(request).not.toHaveBeenCalled();
  const rolling = review.roll();
  expect(review.state.busy).toBe("rolling");
  review.open({ ...design, id: "another_avatar" });
  response.resolve({ image: image("b") });
  await rolling;
  expect(review.state).toMatchObject({
    id: "another_avatar",
    role: null,
    busy: "",
  });
  expect(review.state.image).toEqual(design.base);
});

it("keeps a failed confirmation retryable and saves accepted bytes without editing instructions", async () => {
  const request = vi.fn(async () => ({
    image: image("b"),
    model: "test",
    usage: {},
  }));
  const review = createAuthoringVisualDraft({ request, reference });
  review.open(design);
  review.describe("A bright\n dinosaur.");
  await review.roll("portrait", "PRIVATE-EDIT-INSTRUCTION");
  expect(request.mock.calls[0][0].description).toBe("A bright dinosaur.");
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("Storage full"))
    .mockResolvedValue(undefined);
  expect(await review.confirm(save)).toBe(false);
  expect(review.state).toMatchObject({
    role: "portrait",
    error: "Storage full",
    revision: 1,
  });
  expect(await review.confirm(save)).toBe(true);
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
  expect(Object.keys(save.mock.calls[0][0])).toEqual(["description", "images"]);
  expect(Object.keys(save.mock.calls[0][0].images[0])).toEqual([
    "role",
    "mime",
    "bytes",
  ]);
  expect(JSON.stringify(save.mock.calls)).not.toContain(
    "PRIVATE-EDIT-INSTRUCTION",
  );
  expect(review.state).toMatchObject({
    role: null,
    revision: 2,
    confirmed: true,
  });
  expect(request).toHaveBeenCalledTimes(1);
});

it("binds all six poses to the confirmed portrait and guards the save boundary", async () => {
  const request = vi.fn(async () => ({ image: image("b") }));
  const split = vi.fn(async () => ({
    sheet: { ...image("b"), role: "sheet" },
    cells: POSE_ROLES.map((role) => ({ ...image("c"), role })),
  }));
  const review = createAuthoringVisualDraft({ request, reference, split });
  review.open({ ...design, base: undefined });
  await expect(review.roll("pose-sheet")).rejects.toThrow(/Confirm/);
  await review.roll();
  await expect(review.roll("pose-sheet")).rejects.toThrow(/Confirm/);
  await review.confirm(async () => {});
  review.describe("A red dinosaur.");
  await expect(review.roll("pose-sheet")).rejects.toThrow(/Confirm/);
  review.describe(design.description);
  await review.roll("pose-sheet");
  expect(JSON.parse(request.mock.lastCall[0].basis).slice(0, 3)).toEqual([
    design.id,
    2,
    "b".repeat(64),
  ]);
  expect(review.state.poses.map((value) => value.role)).toEqual(POSE_ROLES);
  const calls = request.mock.calls.length;
  await review.reviewSheet(image("b"));
  expect(request).toHaveBeenCalledTimes(calls);
  expect(review.state.role).toBe("pose-sheet");
  const saving = deferred(),
    save = vi.fn(() => saving.promise),
    pending = review.confirm(save);
  expect(save.mock.calls[0][0].images).toHaveLength(8);
  expect(() => review.open(null)).toThrow(/finish saving/);
  expect(() => review.cancel()).toThrow(/finish saving/);
  saving.resolve();
  expect(await pending).toBe(true);
  await review.roll();
  await review.confirm(async () => {});
  expect(review.state.poses).toEqual([]);
  expect(review.state.sheet).toBeUndefined();
});
