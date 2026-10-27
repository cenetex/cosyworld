const card = (name) => `story-quest-greek-homecoming-${name}`;
const open = (name) => `greek-open-door-${name}`;
const home = (name) => `greek-homecoming-${name}`;
const fullReturn = open("return-dione");
const reports = [
  [
    "agora",
    "Bring the city's answer to Dione.",
    ["hear-truce-report", "hear-recovery-report"],
    ["truce", "force"],
  ],
  [
    "eleusis",
    "Bring the mothers' answer to Dione.",
    ["eleusis-pledge", "eleusis-care"],
    ["pledge", "care"],
  ],
  [
    "piraeus",
    "Tell Dione who the berth will welcome.",
    ["family-berth", "open-berth"],
    ["family", "open"],
  ],
  [
    "colonus",
    "Bring the grove's story to Dione.",
    ["colonus-custom", "colonus-family"],
    ["custom", "family"],
  ],
  [
    "marathon",
    "Bring the children's story to Dione.",
    ["marathon-alcmene", "marathon-hearing"],
    ["alcmene", "hearing"],
  ],
];
const arrival = [home("receive-family"), home("receive-open")];
const stories = [
  ...reports.map(([place, line, starts, variants]) => ({
    id: card("return"),
    suffix: `:${place}`,
    line,
    holder: "greek-baker",
    art: "greek-bread",
    starts: starts.map(open),
    endings: [
      ...variants.map((variant) => home(`report-${place}-${variant}`)),
      fullReturn,
    ],
    completion: "Shared",
  })),
  {
    id: card("household"),
    suffix: "",
    line: "Bring Myrine to the waiting berth.",
    holder: "greek-household-witness",
    art: "greek-return-list",
    starts: [home("agree-journey")],
    endings: arrival,
    completion: "Fulfilled",
  },
  {
    id: card("witness"),
    suffix: "",
    line: "Read Myrine's account beside your song.",
    holder: "greek-baker",
    art: "greek-return-list",
    starts: arrival,
    endings: ["basket-family", "basket-open", "berth-family", "berth-open"].map(
      (name) => home(`read-${name}`),
    ),
    completion: "Shared",
  },
];
const key = (story) => `greek-drama:${story.id}${story.suffix}`;
export const HOMECOMING_QUEST_CARDS = [...new Set(stories.map(({ id }) => id))];

// A report belongs to one journey. Later journeys keep their own stable cards.
// The first report remains the receipt even when the full song follows it.
export function homecomingDefinitions(world) {
  const receipts = world.packs?.["greek-drama"]?.receipts || {};
  const earned = (ids) => ids.filter((id) => Object.hasOwn(receipts, id));
  return stories.flatMap((story) => {
    const started = earned(story.starts);
    if (!started.length) return [];
    const ending = earned(story.endings).sort(
      (a, b) => receipts[a] - receipts[b],
    )[0];
    return [
      {
        id: story.id,
        key: key(story),
        title: story.line,
        purpose: story.line,
        singleLine: true,
        story: true,
        status: ending ? "fulfilled" : "pending",
        art: story.art,
        resolved: Boolean(ending),
        completion: story.completion,
        holder: { kind: "avatar", id: story.holder },
        choiceId: ending || story.endings[0],
        createdTurn: Math.min(...started.map((id) => receipts[id])),
      },
    ];
  });
}

export function homecomingRelated(definition, event) {
  const story = stories.find((entry) => key(entry) === definition.key);
  return Boolean(
    story &&
      event.packId === "greek-drama" &&
      [...story.starts, definition.choiceId].includes(event.choiceId),
  );
}
