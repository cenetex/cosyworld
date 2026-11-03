// Phones put Web Audio to sleep when the tab or the browser goes to the
// background: Chrome reports "suspended", iOS Safari "interrupted" (also after
// a call or Siri). A context left asleep plays its songs silently, so each
// player wakes it when the page shows again. iOS can refuse that without a
// gesture; the players then try again on the next tap or key.
export const contextAsleep = (context) =>
  context?.state === "suspended" || context?.state === "interrupted";

// Settles true once the context runs (or there is none). Never rejects.
export function wakeContext(context) {
  if (!contextAsleep(context)) return Promise.resolve(true);
  try {
    return Promise.resolve(context.resume?.()).then(
      () => !contextAsleep(context),
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

export const RETURN_FADE_SECONDS = 0.4;
