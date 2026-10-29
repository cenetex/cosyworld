// Revision 8 shares landing access and keeps the return with the carried plea.
export function expectedEpicGreekEntry(kind, entry) {
  const expected = structuredClone(entry);
  if (
    kind === "choices" &&
    ["greek-helen-troy", "greek-ajax-invitation"].includes(expected.id)
  )
    expected.effects.push({
      kind: "set_flag",
      key: "greek-camp-road-open",
      value: true,
    });
  if (kind === "storyQuests" && expected.id === "story-quest-greek-ajax-return")
    expected.holder = { kind: "item", id: "greek-ajax-plea" };
  return expected;
}
