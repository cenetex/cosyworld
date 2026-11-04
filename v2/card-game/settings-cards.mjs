// Settings is a hand of cards (owner, 2026-11-03): choosing a card puts its
// action in the context button, and pressing the button does it. A card
// shows its name and art; its face is its state, lit or dim. Every state
// word and reason is in the button or the beat's info line, never on a card.
// This is the hand and its beats; settings-screen.mjs draws them (README,
// Settings).

// [card, its control, name, art, status line, label while on, label while
// off]; one label is "Turn x" off or on. A control the browser holds off
// (Global Privacy Control) gives its reason.
export const TOGGLES = [
  [
    "music",
    "music-toggle",
    "Music",
    "lamp-card.png",
    "music-status",
    "Turn music",
  ],
  [
    "voices",
    "speech-sound",
    "Voices",
    "bell-card.png",
    "voice-status",
    "Turn voices",
  ],
  [
    "scares",
    "scares-toggle",
    "Flashes and scares",
    "lonely-forest/skull.png",
    "",
    "Turn flashes and scares",
  ],
  [
    "fight",
    "combat-speed",
    "Fight speed",
    "combat/vale-attack.webp",
    "",
    "Fight at 1×",
    "Fight at 2×",
  ],
  [
    "counts",
    "metrics-toggle",
    "Play counts",
    "lonely-forest/watch-bell.webp",
    "",
    "Stop sharing play counts",
    "Share play counts",
  ],
];
// The owner's four packs. Every compiled pack is mounted in every world
// (`installPacks` in world.mjs; `validatePackStates` refuses a save without
// one), so none can be switched off, and the button says so. Each is a
// place card, drawn as the quest card draws its place (`place`).
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

// The hand for what the table knows now (`readSettings`), Privacy first.
export function settingsCards(s) {
  const toggles = TOGGLES.map(([id, control, name, art, status, on, off]) => {
    const t = s.toggles[id];
    const label = off ? (t.on ? on : off) : `${on} ${t.on ? "off" : "on"}`;
    const run = t.disabled
      ? reason(`${name}: ${t.state}`)
      : act(label, `#${control}`);
    return card(id, name, art, t.on, t.state, [run], { info: t.info });
  });
  const next = VOLUMES.find((v) => v > s.volume) ?? VOLUMES[0];
  const commit = (n) =>
    s.balance < n
      ? reason(`Commit ${n}: you hold ${s.balance}`)
      : act(`Commit ${n} credits`, `[data-commit="${n}"]`, { closes: true });
  const signedIn = s.signedIn ? "signed in" : "signed out";
  return [
    card("privacy", "Privacy", "cloth-card.png", true, "", [
      act("Open privacy", "privacy"),
    ]),
    toggles[0],
    card("volume", "Volume", "oil-card.png", s.volume > 0, `${s.volume}%`, [
      act(`Set volume to ${next}%`, "volume", { value: next }),
    ]),
    ...toggles.slice(1),
    s.hosted &&
      card("account", "Account", s.avatar, s.signedIn, signedIn, [
        s.signedIn
          ? act("Sign out", "signOut", { confirm: "Tap again to sign out" })
          : act("Sign in with your passkey", "signIn"),
      ]),
    s.shared &&
      s.signedIn &&
      card(
        "passkey",
        "Another passkey",
        "lonely-forest/wolfprint-charm.webp",
        true,
        "",
        [act("Add a passkey", "addPasskey")],
      ),
    s.hosted &&
      card(
        "credits",
        "Credits",
        "lonely-forest/story-button.webp",
        s.signedIn,
        s.credits,
        [
          s.checkout
            ? act("Get a speech pack: 100 credits", "#buy-speech-pack")
            : act("Get a speech pack", "speechPack"),
        ],
        { info: s.credits },
      ),
    s.pool !== null &&
      card(
        "pool",
        "World pool",
        "lonely-forest/dewbright-button.webp",
        true,
        s.pool,
        s.signedIn
          ? [commit(10), commit(100)]
          : [reason("Sign in to commit credits")],
        { info: s.pool },
      ),
    s.backup !== null &&
      card(
        "backup",
        "Backup",
        "attic.png",
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
        "rest/long-rest.webp",
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
      "keeper.png",
      true,
      "",
      [act("Next tip", "tip")],
      { info: TIPS[s.tip % TIPS.length] },
    ),
    card(
      "download",
      "Download",
      "station.png",
      true,
      "",
      [act("Download the game", "download")],
      { info: s.build },
    ),
    ...PACKS.map(([id, name, art]) =>
      card(
        `pack-${id}`,
        name,
        art,
        true,
        "mounted",
        [
          reason(
            id === "shore"
              ? "Every world starts on The Reflected Shore"
              : `Every world holds ${name}`,
          ),
        ],
        { place: true },
      ),
    ),
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
