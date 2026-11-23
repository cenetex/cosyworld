// The Read view shows only the claims of a book the player has just read.
import { claimsIn } from "./claims.mjs";
import { nameOf } from "./world/catalog.mjs";

export function readPage(world, actor, seen) {
  const entry = world.log.findLast(
    (e) => e.verb === "read" && e.actorId === actor && !e.generated,
  );
  const claims = claimsIn(entry?.itemId);
  if (!entry || entry.seq <= seen || entry.turn !== world.turn || !claims.length)
    return null;
  return {
    seq: entry.seq,
    title: nameOf(entry.itemId),
    author: nameOf(claims[0].author),
    claims: claims.map((claim) => claim.text),
  };
}

export function createReadView({ root = document.body, opened = () => {} }) {
  const make = (tag, className = "") => {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  };
  const dialog = make("dialog"),
    heading = make("div", "modal-heading"),
    title = make("h2"),
    close = make("button"),
    byline = make("p", "kicker"),
    claims = make("div");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => dialog.close());
  heading.append(title, close);
  dialog.append(heading, byline, claims);
  root.append(dialog);
  let seen = null;
  return {
    observe(world, actor) {
      const page = seen === null ? null : readPage(world, actor, seen);
      seen = world.eventSeq ?? 0;
      if (!page) return;
      dialog.setAttribute("aria-label", page.title);
      title.textContent = page.title;
      byline.textContent = `by ${page.author}`;
      claims.replaceChildren(
        ...page.claims.map((text) => {
          const line = make("p");
          line.textContent = text;
          return line;
        }),
      );
      dialog.showModal();
      opened();
    },
  };
}
