// Upgrades for saves written before the Steam Clock became a world pack.
// Schema 6 kept the forest crossing in a dedicated `steamClock` record and
// recorded a bell as Badger's wake cause. Schema 7 keeps crossings, pack state
// and the general "sound" cause instead. This is the only module that maps
// that old shape onto the pack's ids.
export function upgradeSteamClockSave(s) {
  const clock = s.steamClock;
  delete s.steamClock;
  // A shore save from before the clearing existed gains the pack fresh.
  if (!clock || typeof clock !== "object") return;
  s.crossings = {
    "pond-clearing": {
      discovered: clock.discovered,
      phase: clock.rings,
      until: clock.openUntil ?? 0,
    },
    "clearing-pond": { discovered: false },
  };
  s.packs = {
    "badger-forest": {
      revision: 1,
      sounds: { "steam-clock": clock.returnRingingUntil ?? 0 },
    },
  };
  if (s.actors?.badger?.wakeCause === "bell")
    s.actors.badger.wakeCause = "sound";
}
