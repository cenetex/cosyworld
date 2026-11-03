// A test copy of the Greek pack with the rules 95 item cycle: bread, figs and
// wine regrow at home; Myrto makes the provisions from them in a repeating
// give; the Piraeus voyage spends them; two homed things form a kit; and the
// City Gate's road shows a sealed card.
export function itemCycleFixture(compiled) {
  const original = structuredClone(compiled);
  const greek = original.packs.find((p) => p.id === "greek-drama");
  const thing = (name, holder, extra) => ({
    name,
    text: `A ${name.toLowerCase()} for the test loop.`,
    persona: "Describe the object, its actual holder, and recorded use.",
    holder,
    art: "assets/greek-drama/bread.png",
    ...extra,
  });
  Object.assign(greek.items["greek-bread"], {
    home: "greek-courtyard",
    regrow: "dawn",
  });
  Object.assign(greek.items, {
    "greek-test-figs": thing("Test Figs", "greek-sanctuary", {
      home: "greek-sanctuary",
      regrow: "rest",
      absentReturn: true,
    }),
    "greek-test-water": thing("Test Water", "greek-well", {
      home: "greek-well",
      regrow: "dawn",
    }),
    "greek-test-wine": thing("Test Wine", "greek-gate", {
      home: "greek-gate",
      regrow: "dusk",
    }),
    "greek-test-shell": thing("Test Shell", "greek-well", {
      home: "greek-well",
    }),
    "greek-test-stone": thing("Test Stone", "greek-well", {
      home: "greek-well",
    }),
  });
  Object.assign(greek.items["greek-provisions"], {
    home: "greek-harbor",
    startsUsed: true,
  });
  // The shipped loop gives way to the test's own set.
  greek.choices = greek.choices.filter((c) => c.id !== "greek-pack-provisions");
  greek.release.choices = greek.release.choices.filter(
    (id) => id !== "greek-pack-provisions",
  );
  greek.choices.push({
    id: "greek-test-pack",
    subject: "greek-shipmaster",
    at: "greek-harbor",
    label: "Pack the provisions",
    text: "Myrto packs the provisions and sets them on the landing.",
    on: "give",
    repeats: true,
    // The drink slot takes the wine or the water.
    requires: [
      ...["greek-bread", "greek-test-figs"].map((item) => ({
        kind: "holding",
        item,
        role: "actor",
      })),
      {
        kind: "any",
        conditions: ["greek-test-wine", "greek-test-water"].map((item) => ({
          kind: "holding",
          item,
          role: "actor",
        })),
      },
    ],
    effects: [
      ...[
        "greek-bread",
        "greek-test-figs",
        "greek-test-wine",
        "greek-test-water",
      ].map((item) => ({
        kind: "retire_item",
        item,
      })),
      { kind: "drop_item", item: "greek-provisions" },
    ],
  });
  greek.kits = [
    {
      id: "greek-test-kit",
      items: ["greek-test-shell", "greek-test-stone"],
      places: ["greek-courtyard", "greek-palace", "forest-cottage"],
      on: "dawn",
    },
  ];
  greek.release.items.push(
    "greek-test-figs",
    "greek-test-wine",
    "greek-test-water",
    "greek-test-shell",
    "greek-test-stone",
  );
  greek.release.choices.push("greek-test-pack");
  const lane = greek.transports["greek-ship"].lanes.find(
    (l) => l.from === "greek-harbor" && l.to === "greek-piraeus",
  );
  lane.spends = true;
  for (const r of greek.routes)
    if (r.from === "greek-gate" && r.to === "greek-battlefield")
      r.sealed = {
        reason: "The guard keeps the road shut until he holds an order.",
        quest: { kind: "item", target: "greek-decree", to: "greek-guard" },
      };
  return original;
}
