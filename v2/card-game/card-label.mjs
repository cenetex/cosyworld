// A card's name sits at its top in one label for every card (style.css). It
// breaks only between words: a hyphenated or dashed word ("Wine-Dark",
// "Colonus–Marathon") is kept whole, since CSS alone would break after its
// dash. The label's text stays the plain name.
export function setCardLabel(el, name = "") {
  el.replaceChildren(
    ...String(name)
      .split(/(\s+)/u)
      .map((part) =>
        /\S[-‐–—]\S/u.test(part)
          ? Object.assign(document.createElement("span"), {
              className: "label-word",
              textContent: part,
            })
          : part,
      ),
  );
  return el;
}
