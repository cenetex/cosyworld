// Settings is a hand of cards (owner, 2026-11-03), dealt as the play hand
// deals a place and the things in it (owner, 2026-11-04): four group cards,
// You, Sound, Play and World, each holding its settings as a place holds its
// items. Choosing a setting puts its action in the context button, and
// pressing the button does it. A card shows its name and art; its face is
// its state, lit or dim. Every state word and reason is in the button or the
// beat's info line, never on a card. This is the hand and its beats;
// settings-screen.mjs draws them (README, Settings).

// [card, its control, name, art, status line, label while on, label while
// off]; one label is "Turn x" off or on. A control the browser holds off
// (Global Privacy Control) gives its reason.
export const TOGGLES = [
  [
    "music",
    "music-toggle",
    "Music",
    bench("lamplight"),
    "music-status",
    "Turn music",
  ],
  [
    "voices",
    "speech-sound",
    "Voices",
    bench("ears"),
    "voice-status",
    "Turn voices",
  ],
  [
    "scares",
    "scares-toggle",
    "Flashes and scares",
    bench("wing"),
    "",
    "Turn flashes and scares",
  ],
  [
    "fight",
    "combat-speed",
    "Fight speed",
    bench("dice-cup"),
    "",
    "Fight at 1×",
    "Fight at 2×",
  ],
  [
    "counts",
    "metrics-toggle",
    "Play counts",
    bench("dice"),
    "",
    "Stop sharing play counts",
    "Share play counts",
  ],
];
// The owner's moonlit workbench is the scene, and its regions are the cards'
// paintings (assets/settings/PROVENANCE.md). Every card is a place card,
// drawn as the quest card draws its place, like the packs below.
export const SCENE = "settings/source/moonlit-cozy-fantasy-workbench.png";
export const BENCH = [
  ...["letter", "dice", "dice-cup", "candle", "old-books", "mug"],
  ...["armillary", "scroll", "book-stack", "window", "moth", "you"],
  ...["play", "lamplight", "flame", "ears", "wing", "gear", "moon"],
];
function bench(name) {
  return `settings/workbench-${name}.png`;
}
// The owner's four packs, by their switchable groups (rules 98,
// pack-toggle.mjs), lead World. A pack card is lit while it is on; its
// button switches it, or says why it can't.
export const PACKS = [
  ["cottage", "Cosy Cottage", "lonely-forest/cottage.png"],
  ["shore", "The Reflected Shore", "pond.png"],
  ["sea", "The Wine-Dark Sea", "greek-drama/harbor-open-berth.webp"],
  [
    "hoppy",
    "Hoppy Cat Universe",
    "hoppycat-archive/hoppycat-halfway-tea-garden.webp",
  ],
];
// The groups in hand order, [card, name, painting, the settings it holds].
// Privacy is the first thing You holds, and You opens fanned.
export const GROUPS = [
  ["you", "You", "you", ["privacy", "account", "passkey", "counts"]],
  ["sound", "Sound", "candle", ["music", "voices", "volume"]],
  ["play", "Play", "play", ["fight", "scares", "controls"]],
  [
    "world",
    "World",
    "window",
    [...PACKS.map(([id]) => `pack-${id}`), "new-game", "backup", "download"],
  ],
];
export const VOLUMES = [15, 30, 60, 100];
export const TIPS = [
  "Tap a card to select it, and again to unselect it. Select one or two cards, then tap an action button below to play.",
  "Escape or the scene lowers them. Select a person to reveal their items. Swipe or scroll the hand to reach more cards.",
  "Arrow keys move between cards. Enter or Space toggles selection. Playing an action advances the world.",
];

const act = (label, run, more) => ({ label, run, ...more });
const reason = (label) => act(label, null, { disabled: true });
const card = (id, name, art, lit, state, actions, more) => ({
  ...{ id, name, lit, state, actions, ...more },
  art: /^(\.|\/|assets\/)/.test(art) ? art : `assets/${art}`,
});

// The hand for what the table knows now (`readSettings`): each group card,
// then the settings it holds (`holder`), as the play hand deals a place and
// then its things.
export function settingsCards(s) {
  const cards = dealt(s);
  return GROUPS.flatMap(([group, name, art, ids]) => {
    const held = ids
      .map((id) => cards.find((c) => c.id === id))
      .filter(Boolean)
      .map((c) => ({ ...c, holder: group }));
    const names = held.map((c) => c.name).join(", ");
    const box = card(group, name, bench(art), true, names, [], { group: true });
    return [box, ...held];
  });
}
function dealt(s) {
  const toggles = TOGGLES.map(([id, control, name, art, status, on, off]) => {
    const t = s.toggles[id];
    const label = off ? (t.on ? on : off) : `${on} ${t.on ? "off" : "on"}`;
    const run = t.disabled
      ? reason(`${name}: ${t.state}`)
      : act(label, `#${control}`);
    return card(id, name, art, t.on, t.state, [run], { info: t.info });
  });
  const next = VOLUMES.find((v) => v > s.volume) ?? VOLUMES[0];
  const signedIn = s.signedIn ? "signed in" : "signed out";
  return [
    card("privacy", "Privacy", bench("letter"), true, "", [
      act("Open privacy", "privacy"),
    ]),
    toggles[0],
    card("volume", "Volume", bench("flame"), s.volume > 0, `${s.volume}%`, [
      act(`Set volume to ${next}%`, "volume", { value: next }),
    ]),
    ...toggles.slice(1),
    s.hosted &&
      card("account", "Account", bench("moth"), s.signedIn, signedIn, [
        s.signedIn
          ? act("Sign out", "signOut", { confirm: "Tap again to sign out" })
          : act("Sign in with your passkey", "signIn"),
      ]),
    s.shared &&
      s.signedIn &&
      card("passkey", "Another passkey", bench("gear"), true, "", [
        act("Add a passkey", "addPasskey"),
      ]),
    s.backup !== null &&
      card(
        "backup",
        "Backup",
        bench("scroll"),
        true,
        "",
        [
          act("Save backup", "#local-export"),
          act("Restore a backup", "#local-import", {
            confirm: "Tap again to replace this game",
          }),
        ],
        { info: s.backup },
      ),
    s.newGame &&
      card(
        "new-game",
        "New game",
        bench("moon"),
        true,
        "",
        [
          act("Start a new game", "#confirm-reset", {
            confirm: "Tap again to replace this world",
            closes: true,
          }),
        ],
        { info: s.table },
      ),
    card(
      "controls",
      "Controls",
      bench("armillary"),
      true,
      "",
      [act("Next tip", "tip", { stays: true })],
      { info: TIPS[s.tip % TIPS.length] },
    ),
    card(
      "download",
      "Download",
      bench("book-stack"),
      true,
      "",
      [act("Download the game", "download")],
      { info: s.build },
    ),
    ...PACKS.map(([id, name, art]) => {
      const { on, block } = s.packs[id];
      const turn = act(`Turn ${name} ${on ? "off" : "on"}`, "pack", {
        ...{ pack: id, enable: !on },
      });
      const state = on ? "on" : "off";
      return card(`pack-${id}`, name, art, on, state, [
        block ? reason(block) : turn,
      ]);
    }),
  ].filter(Boolean);
}

// The context button's beat for the chosen card, or Close settings. A
// confirm action's first press arms it (`armed` is "card:index").
export function settingsBeat(cards, chosen, armed) {
  const shown = cards.find((c) => c.id === chosen);
  if (!shown)
    return { name: "Settings", actions: [act("Close settings", "close")] };
  const actions = shown.actions.map((a, i) =>
    armed === `${shown.id}:${i}` ? { ...a, label: a.confirm } : a,
  );
  return { name: shown.name, info: shown.info, actions };
}
