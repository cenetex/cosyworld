import { currentActor, nameOf } from "./world.mjs";
import { projectReadingView, readingReplayAction } from "./reading-actions.mjs";
import { readingCatalogs } from "./poem-catalogs.mjs";
import { packDefinition } from "./pack-registry.mjs";

export const readingReview = (world) =>
  world.readingView || projectReadingView(world, currentActor(world));

export function reviewReadingPage(packId, view, reading, page) {
  const catalog = readingCatalogs[packId][reading.catalog];
  return page[2].map((index) => {
    const [row, turn, author, variant] = view.stanzas[index];
    return {
      id: catalog.rows[row].choice,
      turn,
      author:
        author === null ? "An earlier traveler" : catalog.authors[author].name,
      lines: variant ? catalog.rows[row].after.lines : catalog.rows[row].lines,
    };
  });
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function installReadingReview(menu, getWorld, play) {
  const button = element("button", "Shared readings");
  button.id = "reading-button";
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-controls", "reading-dialog");
  const dialog = element("dialog", undefined, "players-dialog reading-dialog");
  dialog.id = "reading-dialog";
  dialog.setAttribute("aria-labelledby", "reading-title");
  const content = element("div");
  const close = element("button", "Close", "players-close");
  close.type = "button";
  close.onclick = () => dialog.close();
  dialog.append(content, close);
  menu.append(button);
  document.body.append(dialog);
  let selected = null,
    pageIndex = 0;
  const changed = () =>
    document.dispatchEvent(new Event("shared-dialog-change"));
  dialog.addEventListener("close", () => {
    changed();
    button.focus();
  });
  const actionButton = (action) => {
    const node = element("button", action.label);
    node.type = "button";
    node.onclick = () => {
      dialog.close();
      play(action);
    };
    return node;
  };
  function render() {
    const world = getWorld(),
      actor = currentActor(world),
      archive = readingReview(world);
    content.replaceChildren(element("h2", "Shared readings"));
    content.firstChild.id = "reading-title";
    const controls = element("div", undefined, "reading-controls");
    for (const action of archive.actions) controls.append(actionButton(action));
    content.append(controls);
    const records = Object.entries(archive.packs)
      .flatMap(([packId, view]) =>
        view.readings.map((reading) => ({ packId, view, reading })),
      )
      .reverse();
    if (!records.length) {
      content.append(
        element(
          "p",
          "Bring a journey’s record to Dione, or visit the poets’ court. Your readings will appear here.",
        ),
      );
      return;
    }
    const choose = element("select");
    choose.setAttribute("aria-label", "Choose a reading");
    for (const record of records) {
      const site = packDefinition(record.packId).recital.sites.find(
        (s) => s.id === record.reading.site,
      );
      const option = element(
        "option",
        `${site.title} — read by ${nameOf(record.reading.reader)}`,
      );
      option.value = `${record.packId}/${record.reading.id}`;
      choose.append(option);
    }
    if (!records.some((r) => `${r.packId}/${r.reading.id}` === selected))
      selected = choose.options[0].value;
    choose.value = selected;
    choose.onchange = () => {
      selected = choose.value;
      pageIndex = 0;
      render();
    };
    content.append(choose);
    const { packId, view, reading } = records.find(
      (r) => `${r.packId}/${r.reading.id}` === selected,
    );
    content.append(
      element(
        "p",
        `Read by ${nameOf(reading.reader)}. Begun on turn ${reading.readingTurn}, with deeds through turn ${reading.through}.`,
      ),
    );
    if (!reading.pages.length) {
      content.append(element("p", "The reading is ready for its first page."));
      return;
    }
    pageIndex = Math.min(pageIndex, reading.pages.length - 1);
    const page = reading.pages[pageIndex];
    content.append(
      element("h3", `Page ${page[0] + 1} of ${reading.pageCount}`),
    );
    content.append(
      element(
        "p",
        page[1] === null ? "Ready to read" : `First read on turn ${page[1]}`,
        "reading-status",
      ),
    );
    const verses = element("div", undefined, "reading-verses");
    for (const stanza of reviewReadingPage(packId, view, reading, page)) {
      const verse = element("blockquote");
      verse.append(
        element("p", stanza.lines.join("\n")),
        element(
          "footer",
          `Original author: ${stanza.author} · turn ${stanza.turn}`,
        ),
      );
      verses.append(verse);
    }
    content.append(verses);
    const navigation = element("div", undefined, "reading-controls");
    for (const [label, delta] of [
      ["Previous page", -1],
      ["Next page", 1],
    ]) {
      const next = element("button", label);
      next.type = "button";
      next.disabled =
        pageIndex + delta < 0 || pageIndex + delta >= reading.pages.length;
      next.onclick = () => {
        pageIndex += delta;
        render();
      };
      navigation.append(next);
    }
    content.append(navigation);
    if (reading.reader === actor)
      for (const listener of reading.audience || []) {
        const action = readingReplayAction(
          world,
          actor,
          packId,
          reading.id,
          page[0],
          listener,
        );
        if (action) content.append(actionButton(action));
      }
  }
  button.onclick = () => {
    render();
    dialog.showModal();
    changed();
  };
}
