// Players and characters see the quiet play as Observe. The rules keep the
// verb id `wait` and commit "Name waits one turn." in the journal and the
// released shared bundles, so the wording changes only where it is shown or
// sent to the narrator. Replay and saves are unchanged.
const WAITS = /^(.+) waits one turn\.$/u;

/** Shown text for a committed or offered action sentence. */
export const observeText = (text) =>
  typeof text === "string" ? text.replace(WAITS, "$1 observes.") : text;
