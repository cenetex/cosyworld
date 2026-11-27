import { expect, it } from "vitest";
import { createPagedReveal, speechPages } from "../v2/card-game/speech-pages.mjs";

const upTo = (limit) => (part) => part.length <= limit;

it("splits a line between sentences only when it does not fit", () => {
  const text = "The night is long. The bread is patient. So am I, for now.";
  expect(speechPages(text, upTo(80))).toEqual([text]);
  expect(speechPages(text, upTo(42))).toEqual([
    "The night is long. The bread is patient.",
    "So am I, for now.",
  ]);
  expect(speechPages("Wait. And on and on. Done.", upTo(8))).toEqual([
    "Wait.",
    "And on and on.",
    "Done.",
  ]);
});

it("turns pages under one line and completes on the last", () => {
  const frames = [];
  const paged = createPagedReveal({
    frame: (value) => frames.push(value),
    paginate: (text, { whole }) => (whole ? [text] : ["One.", "Two."]),
    requestFrame: null,
  });
  paged.show("line", "One. Two.", "vale");
  expect(paged.nextPage()).toBe(false);
  paged.finish();
  expect(frames.at(-1)).toMatchObject({ page: "One.", complete: false });
  expect(paged.nextPage()).toBe(true);
  paged.finish();
  expect(frames.at(-1)).toMatchObject({
    text: "One. Two.",
    page: "Two.",
    complete: true,
  });
  expect(paged.nextPage()).toBe(false);
  paged.show("read", "One. Two.", "vale", { instant: true });
  expect(frames.at(-1)).toMatchObject({ page: "One. Two.", complete: true });
  paged.show("read", "…", "vale", { instant: true });
  expect(frames.at(-1)).toMatchObject({ page: "…", complete: true });
  paged.cancel();
});
