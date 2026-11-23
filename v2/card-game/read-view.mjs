// The Read view shows only the claims of a book the player has just read.
import { claimsIn } from "./claims.mjs";
import { imageUrl } from "./images.mjs";
import { packThings } from "./pack-registry.mjs";
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
    book: entry.itemId,
    title: nameOf(entry.itemId),
    author: nameOf(claims[0].author),
    claims: claims.map((claim) => claim.text),
    pages: packThings[entry.itemId].pages ?? [],
  };
}

export function createReadView({
  root = document.body,
  opened = () => {},
  closed = () => {},
}) {
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
  let seen = null,
    book = null;
  dialog.addEventListener("close", () => closed(book));
  return {
    observe(world, actor) {
      const page = seen === null ? null : readPage(world, actor, seen);
      seen = world.eventSeq ?? 0;
      if (!page) return;
      book = page.book;
      dialog.setAttribute("aria-label", page.title);
      title.textContent = page.title;
      byline.textContent = `by ${page.author}`;
      claims.replaceChildren(
        ...page.claims.map((text, n) => {
          const line = make("p");
          line.textContent = text;
          const art = page.pages[n % page.pages.length];
          if (art)
            Object.assign(line.style, {
              background: `url("${imageUrl(art, "card")}") left center / 96px no-repeat`,
              minHeight: "96px",
              paddingLeft: "108px",
              display: "flex",
              alignItems: "center",
            });
          return line;
        }),
      );
      dialog.showModal();
      opened();
    },
  };
}
