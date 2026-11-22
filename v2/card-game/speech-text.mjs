// The line in front (#dialogue-text), shown a page at a time, each sized to the room above the hand.
import { nameLetters } from "./card-names.mjs";
import { createRevealPainter, letterSpans } from "./dialogue.mjs";
import { speechPages } from "./speech-pages.mjs";

export function createSpeechText({
  row,
  text,
  hand,
  captions,
  topbar,
  setStyle,
  sceneCards,
  repage,
  stopSounds,
}) {
  const painter = createRevealPainter(text, { rest: true });
  let pageKey = null,
    glyphs = [],
    lines = [],
    height = 0,
    scrollTarget = 0,
    complete = null,
    timer = 0;
  function measure() {
    lines = glyphs.map((glyph) => [
      glyph.offsetTop,
      glyph.offsetTop + glyph.offsetHeight,
    ]);
    height = text.clientHeight;
    scrollTarget = text.scrollTop;
  }
  new ResizeObserver(measure).observe(text);
  function room() {
    const stack = row.parentElement;
    if (
      row.hidden ||
      text.hidden ||
      stack.hidden ||
      stack.dataset.action === "true"
    )
      return (setStyle(text.style, "--speech-room", null), Infinity);
    const { bottom, left, right } = stack.getBoundingClientRect(),
      style = getComputedStyle(row);
    const chrome =
      text.offsetTop +
      row.clientTop +
      parseFloat(style.paddingBottom) +
      17 +
      (captions.hidden ? 0 : captions.offsetHeight) +
      (parseFloat(getComputedStyle(stack).getPropertyValue("--beat-peek")) ||
        0);
    let limit = Math.max(
      topbar.getBoundingClientRect().bottom + 8,
      innerHeight * 0.35,
    );
    for (const name of hand.querySelectorAll(
      ".card-frame:not([hidden]) .name",
    )) {
      const box = name.getBoundingClientRect();
      if (
        box.height &&
        box.bottom < bottom &&
        box.right > left &&
        box.left < right
      )
        limit = Math.max(limit, box.bottom + 6);
    }
    const space = Math.max(
      parseFloat(getComputedStyle(text).lineHeight) * 2 || 44,
      bottom - limit - chrome,
    );
    setStyle(text.style, "--speech-room", `${Math.floor(space)}px`);
    return space;
  }
  const watch = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(repage, 300);
  });
  [text, hand].forEach((part) => watch.observe(part));
  return {
    paginate(words, { whole = false } = {}) {
      const space = room(),
        kept = [...text.childNodes],
        top = text.scrollTop;
      if (whole || space === Infinity) return [words];
      const pages = speechPages(
        words,
        (part) => ((text.textContent = part), text.scrollHeight <= space + 1),
      );
      text.replaceChildren(...kept);
      text.scrollTop = top;
      return pages;
    },
    paint(value) {
      if (pageKey !== value.pageKey) {
        pageKey = value.pageKey;
        complete = null;
        text.scrollTop = 0;
        stopSounds();
        glyphs = letterSpans(value.page);
        text.replaceChildren(...glyphs);
        text.dataset.page = value.pageKey.split("#").at(-1).split(":")[0];
        nameLetters(glyphs, value.page, sceneCards());
        painter.start(glyphs);
        measure();
      }
      painter.paint({ shown: value.shown, complete: value.pageComplete });
      const [top, bottom] = lines[Math.max(0, value.shown - 1)] || [0, 0];
      if (!value.pageComplete && bottom > scrollTarget + height) {
        scrollTarget = top;
        text.scrollTop = top;
      }
      if (complete === value.pageComplete) return false;
      complete = value.pageComplete;
      return true;
    },
    forget() {
      pageKey = null;
    },
  };
}
