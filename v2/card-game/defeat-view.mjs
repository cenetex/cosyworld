// The loss screen, on the black of being driven off: who drove the player
// off and what they lost as full-art cards, with the words under them (never
// on them) written by the dialogue's own reveal. It has no buttons: a tap
// shows the words whole, the next moves on, and the read moves on alone.
// Then app.mjs lifts the black slowly onto wherever the rules put the
// player, where the hand plays on. Presentation only.
import {
  createRevealPainter,
  createTextReveal,
  letterDelay,
  letterSpans,
  splitLetters,
} from "./dialogue.mjs";
import { defeatSummary, lossStep, lossTimes } from "./combat-beats.mjs";
import { nameLetters } from "./card-names.mjs";

const element = (tag, className) =>
  Object.assign(document.createElement(tag), { className });

export function playLoss({
  veil,
  beat,
  cardFace,
  cardColours,
  speed,
  reduced,
}) {
  const { title, changes, cards } = defeatSummary(beat);
  const times = lossTimes({ speed, reduced });
  const layer = element("div", "defeat-reveal");
  layer.inert = true;
  layer.setAttribute("aria-hidden", "true");
  layer.style.setProperty("--cards", cards.length);
  const row = element("div", "defeat-cards");
  for (const id of cards) row.append(element("div", "defeat-card"));
  row.childNodes.forEach((frame, i) => frame.append(cardFace(cards[i])));
  // Every letter is laid out from the start, so nothing reflows as it writes.
  const line = element("p", "defeat-line");
  line.append(...letterSpans(title));
  const captions = element("div", "beat-captions defeat-captions");
  for (const { kind, text } of changes) {
    const item = element("span", "beat-caption");
    item.dataset.kind = kind;
    item.append(element("span", ""));
    item.lastChild.append(...letterSpans(text));
    captions.append(item);
  }
  layer.append(row, line, captions);
  // The fight's cards and the place keep their card colours in the words.
  const named = cardColours([...cards, beat.locationId]);
  nameLetters([...line.children], title, named);
  changes.forEach(({ text }, i) =>
    nameLetters([...captions.children[i].lastChild.children], text, named),
  );
  veil.append(layer);

  let step = "writing",
    timer = null,
    finish;
  const done = new Promise((resolve) => (finish = resolve));
  // One pen: the line at the dialogue's pace, then each caption at the beat
  // cards' quicker one (300 to 900 ms a caption).
  const spans = [...layer.querySelectorAll(".speech-letter")];
  const painter = createRevealPainter(layer);
  const first = splitLetters(title).length;
  const paces = changes.flatMap(({ text }) => {
    const ms = Math.min(900, Math.max(300, text.length * 20));
    const letters = splitLetters(text).length;
    return Array(letters).fill(ms / letters);
  });
  const pen = createTextReveal({
    reduced: () => reduced,
    delay: (letter, i) => (i < first ? letterDelay(letter) : paces[i - first]),
    frame(value) {
      painter.paint(value);
      if (value.complete) queueMicrotask(() => advance("written"));
    },
  });
  const advance = (event) => {
    const next = lossStep(step, event);
    if (next === step) return;
    step = layer.dataset.step = next;
    clearTimeout(timer);
    if (step === "read") {
      pen.finish();
      timer = setTimeout(() => advance("read"), times.read);
    } else if (step === "leaving")
      layer
        .animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: times.out,
          fill: "forwards",
        })
        .finished.catch(() => {})
        .then(() => (timer = setTimeout(() => advance("left"), times.out)));
    else if (step === "done") {
      pen.cancel();
      removeEventListener("pointerdown", tap, true);
      removeEventListener("keydown", key, true);
      layer.remove();
      finish();
    }
  };
  const tap = () => advance("tap");
  const key = (event) => {
    if (![" ", "Enter", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    tap();
  };
  addEventListener("pointerdown", tap, true);
  addEventListener("keydown", key, true);
  painter.start(spans);
  pen.show("loss", [title, ...changes.map(({ text }) => text)].join(""));
  // Resolves once the words have left the black.
  return { done, cancel: () => advance("cancel") };
}
