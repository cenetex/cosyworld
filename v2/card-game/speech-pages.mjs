import { createTextReveal } from "./dialogue.mjs";

const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });

export function speechPages(text, fits) {
  if (fits(text)) return [text];
  const pages = [];
  let page = "";
  for (const { segment } of sentences.segment(text)) {
    const next = page + segment;
    if (page.trim() && !fits(next.trim())) {
      pages.push(page.trim());
      page = segment;
    } else page = next;
  }
  if (page.trim()) pages.push(page.trim());
  return pages.length ? pages : [text];
}

export function createPagedReveal({ frame, paginate, ...options }) {
  let line = null;
  const inner = createTextReveal({
    ...options,
    frame: (value) =>
      frame({
        ...value,
        key: line.key,
        text: line.text,
        pageKey: value.key,
        page: value.text,
        pageComplete: value.complete,
        complete: value.complete && line.index === line.pages.length - 1,
      }),
  });
  const open = (instant = line.instant) => {
    const page = line.pages[line.index];
    inner.show(
      `${line.key}#${line.index + 1}/${line.pages.length}:${page.length}`,
      page,
      line.speaker,
      { instant },
    );
  };
  return {
    show(key, text, speaker, { instant = false } = {}) {
      if (line?.key === key) return;
      line = { key, text, speaker, instant, index: 0, pages: [text] };
      line.pages = paginate(text, { whole: instant });
      open();
    },
    nextPage() {
      if (!line || !inner.complete || line.index >= line.pages.length - 1)
        return false;
      line.index++;
      open();
      return true;
    },
    repage() {
      if (!line || line.instant || line.index || this.complete) return;
      const pages = paginate(line.text);
      if (pages.join("\n") === line.pages.join("\n")) return;
      line.pages = pages;
      open(inner.complete);
    },
    finish: () => inner.finish(),
    pause: (value) => inner.pause(value),
    cancel() {
      inner.cancel();
      line = null;
    },
    get complete() {
      return inner.complete && (!line || line.index === line.pages.length - 1);
    },
    get pageComplete() {
      return inner.complete;
    },
    get morePages() {
      return Boolean(line) && line.index < line.pages.length - 1;
    },
    get quick() {
      return inner.quick;
    },
  };
}
