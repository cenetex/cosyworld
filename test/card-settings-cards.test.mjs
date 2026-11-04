import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PACKS,
  settingsBeat,
  settingsCards,
} from "../v2/card-game/settings-cards.mjs";

const toggle = (on, state = on ? "on" : "off") => ({ on, state, info: "" });
const table = (more = {}) => ({
  toggles: {
    music: toggle(true),
    voices: toggle(false),
    scares: toggle(true),
    fight: toggle(false, "1×"),
    counts: toggle(true),
  },
  ...{ tip: 0, volume: 30, hosted: false, signedIn: false, shared: false },
  ...{ avatar: "./assets/vale.png", credits: "", checkout: false },
  ...{ pool: null, balance: 0, backup: null, newGame: true, table: "" },
  build: "",
  packs: Object.fromEntries(PACKS.map(([id]) => [id, { on: true }])),
  ...more,
});
const ids = (cards) => cards.map((c) => c.id);
const labels = (cards, id) =>
  cards.find((c) => c.id === id).actions.map((a) => a.label);

describe("settings as a hand of cards", () => {
  it("deals Privacy first and the owner's four packs last", () => {
    const cards = settingsCards(table());
    expect(cards[0].id).toBe("privacy");
    expect(labels(cards, "privacy")).toEqual(["Open privacy"]);
    expect(cards.slice(-4).map((c) => c.name)).toEqual([
      "Cosy Cottage",
      "The Reflected Shore",
      "The Wine-Dark Sea",
      "Hoppy Cat Universe",
    ]);
    // Workbench paintings and packs are place cards; the rest are figures.
    expect(cards.filter((c) => !c.place).map((c) => c.id)).toEqual([
      "music",
      "voices",
      "scares",
    ]);
    expect(cards.filter((c) => c.place).map((c) => c.id)).toEqual(
      expect.arrayContaining(PACKS.map(([id]) => `pack-${id}`)),
    );
    for (const c of cards)
      expect(existsSync(`v2/card-game/${c.art.replace("./", "")}`)).toBe(true);
  });

  it("shows state as the face and says the next action in the button", () => {
    const cards = settingsCards(table());
    const music = cards.find((c) => c.id === "music");
    expect([music.lit, music.state]).toEqual([true, "on"]);
    expect(labels(cards, "music")).toEqual(["Turn music off"]);
    expect(labels(cards, "voices")).toEqual(["Turn voices on"]);
    expect(labels(cards, "fight")).toEqual(["Fight at 2×"]);
    expect(labels(cards, "counts")).toEqual(["Stop sharing play counts"]);
    expect(labels(cards, "volume")).toEqual(["Set volume to 60%"]);
    expect(labels(settingsCards(table({ volume: 100 })), "volume")).toEqual([
      "Set volume to 15%",
    ]);
  });

  it("gives a held-off control's reason in a disabled button", () => {
    const counts = { ...toggle(false), disabled: true };
    counts.state = "off (Global Privacy Control)";
    const s = table();
    s.toggles.counts = counts;
    const [action] = settingsCards(s).find((c) => c.id === "counts").actions;
    expect(action).toMatchObject({
      label: "Play counts: off (Global Privacy Control)",
      disabled: true,
    });
  });

  it("switches a pack, or says why it can't", () => {
    const packs = { ...table().packs, sea: { on: false } };
    packs.shore = { on: true, block: "One world pack stays on" };
    const cards = settingsCards(table({ packs }));
    const sea = cards.find((c) => c.id === "pack-sea");
    expect(sea.lit).toBe(false);
    expect(sea.actions).toMatchObject([{ run: "pack", enable: true }]);
    expect(labels(cards, "pack-sea")).toEqual(["Turn The Wine-Dark Sea on"]);
    expect(labels(cards, "pack-cottage")).toEqual(["Turn Cosy Cottage off"]);
    const shore = cards.find((c) => c.id === "pack-shore");
    expect(shore.actions[0]).toMatchObject({ disabled: true, run: null });
    expect(labels(cards, "pack-shore")).toEqual(["One world pack stays on"]);
  });

  it("deals account cards by sign-in and world", () => {
    expect(ids(settingsCards(table()))).not.toContain("account");
    const out = settingsCards(table({ hosted: true }));
    expect(labels(out, "account")).toEqual(["Sign in with your passkey"]);
    expect(out.find((c) => c.id === "account").lit).toBe(false);
    const shared = table({ hosted: true, signedIn: true, shared: true });
    const cards = settingsCards({ ...shared, newGame: false, pool: "" });
    expect(ids(cards)).toEqual(
      expect.arrayContaining(["account", "passkey", "credits", "pool"]),
    );
    expect(ids(cards)).not.toContain("new-game");
    expect(labels(cards, "pool")).toEqual([
      "Commit 10: you hold 0",
      "Commit 100: you hold 0",
    ]);
  });

  it("asks a second press before a destructive action", () => {
    const cards = settingsCards(table({ hosted: true, signedIn: true }));
    expect(settingsBeat(cards, null, null).actions[0].label).toBe(
      "Close settings",
    );
    const first = settingsBeat(cards, "account", null);
    expect(first.actions[0].label).toBe("Sign out");
    expect(settingsBeat(cards, "account", "account:0").actions[0].label).toBe(
      "Tap again to sign out",
    );
    expect(settingsBeat(cards, "new-game", "new-game:0").actions[0].label).toBe(
      "Tap again to replace this world",
    );
  });
});
