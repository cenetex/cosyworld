const prefix = "greek-open-door-";
const choice = (id) => `${prefix}${id}`;
const cardId = (id) => `story-quest-${prefix}${id}`;
const stories = [
  {
    id: "eleusis",
    line: "Their sons need a road home.",
    holder: "greek-aethra",
    art: "greek-burial-petition",
    start: ["hear-mothers"],
    progress: ["hear-adrastus", "lay-cloths", "lay-ashes", "hear-pyre"],
    endings: ["eleusis-pledge", "eleusis-care"],
  },
  {
    id: "agora",
    line: "A city must answer.",
    holder: "greek-theseus",
    art: "greek-burial-petition",
    start: ["register-plea"],
    progress: ["request-truce", "request-recovery"],
    endings: ["hear-truce-report", "hear-recovery-report"],
  },
  {
    id: "piraeus",
    line: "A berth beside the water.",
    holder: "greek-quay-host",
    art: "greek-return-list",
    start: ["hear-quay"],
    progress: ["set-provisions"],
    endings: ["family-berth", "open-berth"],
  },
  {
    id: "colonus",
    line: "A stranger waits by the grove.",
    holder: "greek-colonus-keeper",
    art: "greek-grove-cup",
    start: ["colonus-enter"],
    progress: ["colonus-water", "colonus-daughters", "colonus-farewell"],
    endings: ["colonus-custom", "colonus-family"],
  },
  {
    id: "marathon",
    line: "The children need a place to rest.",
    holder: "greek-marathon-keeper",
    art: "greek-shelter-blanket",
    start: ["marathon-enter"],
    progress: [
      "marathon-blanket",
      "marathon-daughter",
      "marathon-battle",
      "marathon-captive",
    ],
    endings: ["marathon-hearing", "marathon-alcmene"],
  },
];
stories.push({
  id: "return",
  line: "What welcome will you bring home?",
  holder: "greek-baker",
  art: "greek-bread",
  start: stories.flatMap((story) => story.endings),
  progress: [],
  endings: ["return-dione"],
  completion: "Shared",
});

export const OPEN_DOOR_QUEST_CARDS = stories.map((story) => cardId(story.id));

// Each card follows an authored scene. The saved deed supplies its start,
// ending, and actor; opening a route gives the whole world access.
export function openDoorDefinitions(world) {
  const receipts = world.packs?.["greek-drama"]?.receipts || {};
  return stories.flatMap((story) => {
    const started = [...story.start, ...story.progress, ...story.endings]
      .map(choice)
      .filter((id) => Object.hasOwn(receipts, id));
    if (!started.length) return [];
    const ending = story.endings
      .map(choice)
      .find((id) => Object.hasOwn(receipts, id));
    const id = cardId(story.id);
    return [
      {
        id,
        key: `greek-drama:${id}`,
        title: story.line,
        purpose: story.line,
        singleLine: true,
        story: true,
        status: ending ? "fulfilled" : "pending",
        art: story.art,
        resolved: Boolean(ending),
        completion: story.completion || "Fulfilled",
        holder: { kind: "avatar", id: story.holder },
        choiceId: ending || choice(story.endings[0]),
        createdTurn: Math.min(...started.map((id) => receipts[id])),
      },
    ];
  });
}

export function openDoorRelated(definition, event) {
  const story = stories.find((entry) => cardId(entry.id) === definition.id);
  if (!story || event.packId !== "greek-drama") return false;
  // The return belongs to its first discoverer and the person who reports.
  // Each earlier scene retains its own set of contributors.
  const choices =
    story.id === "return"
      ? story.endings
      : [...story.start, ...story.progress, ...story.endings];
  return choices.some((id) => choice(id) === event.choiceId);
}
