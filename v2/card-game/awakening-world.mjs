export function tableSuffix(search) {
  const table = new URLSearchParams(search).get("table");
  return table && /^[a-z0-9-]{1,40}$/i.test(table) ? `.${table}` : "";
}

export function saveKey(search) {
  return `cosyworld.steam-clock.v1${tableSuffix(search)}`;
}

export function chooseOpening(search, storage) {
  const choice = new URLSearchParams(search).get("world");
  if (choice === "forest" || choice === "shore") return choice;
  try {
    if (storage?.getItem(saveKey(search))) return "forest";
    if (storage?.getItem(`cosyworld.reflected-shore.v1${tableSuffix(search)}`))
      return "shore";
  } catch {}
  return "forest";
}

export function createAwakening() {
  return {
    schema: 1,
    turn: 0,
    badger: { awake: false, irritation: 0, wakeCause: null },
    events: [
      {
        turn: 0,
        actor: "clearing",
        action: "arrive",
        text: "The Steam Clock ticks. Badger has found the warmest patch of moss.",
      },
    ],
  };
}

export function badgerImage(world) {
  return `./assets/badger-${world.badger.awake ? "grumpy" : "sleeping"}.png`;
}

export function awakeningCards(world) {
  const { awake, irritation } = world.badger;
  return [
    {
      id: "badger",
      name: "Grumpy Badger",
      kind: "avatar",
      caption: awake ? "Comically touchy." : "Asleep. Still rather grumpy.",
      detail: awake
        ? irritation > 1
          ? "He would like you to give the clock a rest."
          : "He considers this patch of moss his."
        : "His paws rest on his belly. One ear twitches.",
      action: awake ? "talk" : "wake",
      label: awake ? "Say hello" : "Wake gently",
      image: badgerImage(world),
    },
    {
      id: "clock",
      name: "Steam Clock",
      kind: "item",
      caption: "An old clock. A warm casing.",
      detail: "A little steam curls from the brass. The casing sounds hollow.",
      action: "tap",
      label: "Tap the casing",
    },
    {
      id: "clearing",
      name: "Forest Clearing",
      kind: "location",
      caption: "Sunlight through the leaves.",
      detail: awake
        ? "Stay a while. Let the silence settle."
        : "You could let him sleep a little longer.",
      action: "wait",
      label: "Wait quietly",
      image: "./assets/steam-clock-background.png",
    },
  ];
}

export function playAwakening(world, action) {
  if (!awakeningCards(world).some((card) => card.action === action))
    return world;
  const next = structuredClone(world);
  next.turn++;
  const badger = next.badger;
  const record = (actor, text) =>
    next.events.push({ turn: next.turn, actor, action, text });
  if (action === "wake") {
    badger.awake = true;
    badger.wakeCause = "voice";
    badger.irritation = 1;
    record("player", "You say hello, softly.");
    record("badger", "I had almost finished that nap. Almost.");
  } else if (action === "tap") {
    const wasAsleep = !badger.awake;
    badger.awake = true;
    badger.wakeCause ??= "clock";
    badger.irritation = Math.min(3, badger.irritation + 2);
    record(
      "player",
      "You tap the clock's warm casing. It gives a bright little clang.",
    );
    record(
      "badger",
      wasAsleep
        ? "A clock already makes one noise. You felt it needed another?"
        : "Yes. Still a clock. Your investigation is complete.",
    );
  } else if (action === "talk") {
    record("player", "You say hello to Badger.");
    record(
      "badger",
      badger.irritation > 1
        ? "I shall enjoy our conversation more once my ears stop ringing."
        : badger.irritation === 0
          ? "You may sit there. That bit of moss is merely adequate."
          : "Good morning is a rather bold claim.",
    );
  } else {
    record("player", "You wait quietly by the clock.");
    if (badger.awake) {
      badger.irritation = Math.max(0, badger.irritation - 1);
      record(
        "badger",
        badger.irritation === 0
          ? "At last. Someone with a talent for silence."
          : "Badger smooths his whiskers. His ears slowly settle.",
      );
    } else {
      record(
        "clearing",
        "Badger snores softly. The clock keeps his time for him.",
      );
    }
  }
  next.events = next.events.slice(-80);
  return next;
}

export function decodeAwakening(raw) {
  const world = JSON.parse(raw);
  if (
    world?.schema !== 1 ||
    !Number.isSafeInteger(world.turn) ||
    world.turn < 0 ||
    typeof world.badger?.awake !== "boolean" ||
    !Number.isInteger(world.badger.irritation) ||
    world.badger.irritation < 0 ||
    world.badger.irritation > 3 ||
    ![null, "voice", "clock"].includes(world.badger.wakeCause) ||
    world.badger.awake !== (world.badger.wakeCause !== null) ||
    !Array.isArray(world.events) ||
    world.events.length < 1 ||
    world.events.length > 80 ||
    world.events.some(
      (event) =>
        !Number.isSafeInteger(event.turn) ||
        event.turn < 0 ||
        event.turn > world.turn ||
        !["player", "badger", "clearing"].includes(event.actor) ||
        !["arrive", "wake", "tap", "talk", "wait"].includes(event.action) ||
        typeof event.text !== "string" ||
        event.text.length > 500,
    )
  ) {
    throw new Error(
      "This clearing save needs a fresh start. Use New game in Menu.",
    );
  }
  return world;
}
