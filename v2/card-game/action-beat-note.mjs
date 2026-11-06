// The descriptor's existing note can hold a source document. Its edit key
// names the draft field; callbacks receive plain text, including newlines.
const editors = new WeakMap();
const read = (note) => note.innerText.replace(/\r\n?/g, "\n");

function editor(note) {
  let state = editors.get(note);
  if (state) return state;
  state = {
    edit: null,
    value: "",
    dirty: false,
    composing: false,
    timer: null,
  };
  state.flush = (force = false) => {
    clearTimeout(state.timer);
    state.timer = null;
    if (!state.edit || (state.composing && !force) || (!state.dirty && !force))
      return;
    const value = read(note);
    state.dirty = false;
    const changed = value !== state.value || value !== state.edit.value;
    state.value = value;
    if (changed) state.edit.onInput(value);
  };
  note.addEventListener("input", (event) => {
    if (!state.edit) return;
    state.dirty = true;
    clearTimeout(state.timer);
    // A book is read after a typing pause, or when focus leaves it.
    if (!state.composing && !event.isComposing)
      state.timer = setTimeout(state.flush, 150);
  });
  note.addEventListener("compositionstart", () => {
    state.composing = true;
    clearTimeout(state.timer);
  });
  note.addEventListener("compositionend", () => {
    state.composing = false;
    state.dirty = true;
    state.flush();
  });
  note.addEventListener("blur", () => state.flush(true));
  note.addEventListener("keydown", (event) => {
    if (!state.edit) return;
    // The editor's arrows, newlines and undo belong to the document.
    event.stopPropagation();
    if (event.key === "Escape" && !state.composing && !event.isComposing)
      note.blur();
  });
  editors.set(note, state);
  return state;
}

// edit: {key, label, value, onInput}. A redraw may supply a fresh callback;
// the focused field keeps its DOM, caret, composition and native undo stack.
export function showActionBeatNote(
  note,
  { edit = null, note: text = "" } = {},
) {
  const state = editor(note);
  const sameField = state.edit && edit && state.edit.key === edit.key;
  if (!sameField && state.edit) {
    note.blur();
    state.flush(true);
    state.composing = false;
  }
  state.edit = edit;
  if (!edit) {
    for (const attribute of [
      "contenteditable",
      "role",
      "aria-multiline",
      "aria-label",
      "tabindex",
      "spellcheck",
    ])
      note.removeAttribute(attribute);
    note.textContent = note.title = text;
    note.hidden = !text;
    return;
  }
  note.hidden = false;
  note.contentEditable = "plaintext-only";
  note.setAttribute("role", "textbox");
  note.setAttribute("aria-multiline", "true");
  note.setAttribute("aria-label", edit.label);
  note.tabIndex = 0;
  note.spellcheck = true;
  note.title = "";
  if (
    !sameField ||
    (!state.composing &&
      note.ownerDocument.activeElement !== note &&
      edit.value !== state.value)
  ) {
    // innerText keeps loaded paragraphs as editable line breaks.
    note.innerText = edit.value;
    state.value = edit.value;
    state.dirty = false;
  }
}
