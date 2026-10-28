import { homecomingJourney } from "./greek-homecoming.mjs";
import { humanAvatarIds } from "../../v2/card-game/human-cast.mjs";
import { packDefinition } from "../../v2/card-game/pack-registry.mjs";
import {
  readingPlay as act,
  readingWalk,
  finishReading,
  COURT,
  FROGS,
} from "./greek-readings.mjs";

// Every receipt here comes from an accepted model play on one continuing world.
export function completeSkyReadingWorld() {
  let world = homecomingJourney().world;
  const play = (kind, fields) => {
    world = act(world, kind, fields);
  };
  const go = (place) => {
    world = readingWalk(world, "vale", place);
  };
  const take = (item) => play("take", { item });
  const give = (item, target) => play("give", { item, target });
  const choose = (choiceId) => play("choose", { choiceId });
  const home = (prefix, item) => {
    take(item);
    go("greek-courtyard");
    world = finishReading(world, prefix + "-homecoming");
  };
  choose("greek-vii-open-accounts");
  go("greek-sicily");
  for (const [item, target] of [
    ["greek-vii-crew-basket", "greek-vii-odysseus-crew"],
    ["greek-vii-satyr-basket", "greek-vii-satyr-chorus"],
  ]) {
    take(item);
    give(item, target);
  }
  choose("greek-vii-cyclops-provisions");
  take("greek-vii-cyclops-cup");
  go("greek-vii-inner-cave");
  give("greek-vii-cyclops-cup", "greek-vii-polyphemus");
  go("greek-sicily");
  take("greek-vii-cave-timber");
  go("greek-vii-inner-cave");
  choose("greek-vii-cyclops-brace-exit");
  go("greek-sicily");
  take("greek-vii-escape-list");
  choose("greek-vii-cyclops-crew-consent");
  choose("greek-vii-cyclops-satyr-consent");
  for (const [target, name] of [
    ["greek-vii-odysseus-crew", "crew"],
    ["greek-vii-satyr-chorus", "satyrs"],
  ]) {
    go("greek-sicily");
    play("accompany", { target, destination: "greek-vii-escape-shore" });
    choose(`greek-vii-cyclops-${name}-arrived`);
  }
  choose("greek-vii-cyclops-all-home");
  home("greek-vii-cyclops", "greek-vii-escape-list");
  go("greek-bird-wilderness");
  take("greek-vii-bird-twine");
  choose("greek-vii-birds-refuge-agreement");
  take("greek-vii-nest-basket");
  play("accompany", {
    target: "greek-vii-hoopoe-chorus",
    destination: "greek-vii-air-gate",
  });
  choose("greek-vii-birds-at-gate");
  take("greek-vii-gate-key");
  choose("greek-vii-birds-gate-open");
  play("accompany", {
    target: "greek-vii-hoopoe-chorus",
    destination: "greek-vii-bird-refuge",
  });
  give("greek-vii-nest-basket", "greek-vii-hoopoe-chorus");
  go("greek-vii-air-gate");
  take("greek-vii-refuge-tablet");
  go("greek-vii-bird-refuge");
  choose("greek-vii-birds-open-flight");
  home("greek-vii-birds", "greek-vii-refuge-tablet");
  go("greek-divine-heights");
  take("greek-vii-beetle-harness");
  give("greek-vii-beetle-harness", "greek-vii-trygaeus");
  choose("greek-vii-peace-harness");
  take("greek-vii-peace-rope");
  give("greek-vii-peace-rope", "greek-vii-farmers");
  choose("greek-vii-peace-pull");
  take("greek-vii-peace-grain");
  take("greek-vii-peace-list");
  play("accompany", {
    target: "greek-vii-farmers",
    destination: "greek-attic-farm",
  });
  choose("greek-vii-peace-farmers-arrived");
  give("greek-vii-peace-grain", "greek-vii-farmers");
  choose("greek-vii-peace-harvest");
  home("greek-vii-peace", "greek-vii-peace-list");
  take("lamp");
  go("greek-vii-crag-camp");
  play("light", { item: "lamp" });
  go("greek-scythian-crag");
  choose("greek-vii-prometheus-flame-arrived");
  play("snuff", { item: "lamp" });
  take("greek-vii-io-message");
  take("greek-vii-storm-record");
  go("greek-susa");
  give("greek-vii-io-message", "greek-vii-io");
  choose("greek-vii-prometheus-io-message-arrived");
  go("greek-scythian-crag");
  choose("greek-vii-prometheus-stay");
  home("greek-vii-prometheus", "greek-vii-storm-record");
  play("drop", { item: "lamp", target: "greek-courtyard" });
  go("greek-underworld");
  take("greek-viii-travel-bag");
  go(COURT);
  choose(FROGS + "-carry-burden");
  take("greek-viii-verse-scales");
  world = finishReading(world, FROGS + "-court");
  take("greek-viii-reading-tablet");
  choose(FROGS + "-voice-aeschylus");
  home(FROGS, "greek-viii-reading-tablet");
  return world;
}

export function fullReadingArchiveWorld() {
  let world = completeSkyReadingWorld();
  world.sharedVersion = 1;
  world.controlledActors = [...humanAvatarIds];
  world.presentActors = [...humanAvatarIds];
  const parks = [
    "greek-harbor",
    "greek-athens",
    "greek-piraeus",
    "greek-colonus",
    "greek-eleusis",
    "greek-marathon",
    "greek-gate",
    "greek-well",
  ];
  world = readingWalk(world, "vale", COURT);
  for (let i = 0; i < 8; i++) {
    world = act(world, "read", {
      readingOp: "later",
      siteId: FROGS + "-court",
    });
    const readingId = `optional:${i}:vale`;
    while (
      !world.packs["greek-drama"].poemReadings.readings[readingId].complete
    )
      world = act(world, "read", { readingOp: "page", readingId });
  }
  world = readingWalk(world, "vale", parks[0]);
  for (const [i, actor] of humanAvatarIds.entries()) {
    if (actor === "vale") continue;
    for (const site of packDefinition("greek-drama").recital.sites) {
      world = readingWalk(world, actor, site.at);
      world = finishReading(world, site.id, actor);
    }
    world = readingWalk(world, actor, parks[i]);
  }
  return world;
}
