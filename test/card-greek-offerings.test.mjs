import { describe, expect, it } from "vitest";
import { itemCopies, packTalkChoice } from "../v2/card-game/pack-registry.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";
import { greekStart, landRoad, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const HONEY = "greek-antigone-grave-honey";
const ELECTRA_STOCK = "greek-aeschylean-electra-offering";
const FURY_STOCK = "greek-areopagus-first-offering";
const OIL = "greek-oil-flask";
const GRAVE = "greek-polynices-hollow";
const COURT = "greek-areopagus";
const QUAY = "greek-piraeus";
const TOMB = "greek-argos-tomb";
const PHERAE = "greek-pherae";
const COLONUS = "greek-colonus";
const URN = "greek-ash-urn";
const ELECTRA = "greek-electra-aeschylus";
const ALC = "greek-story-euripides-alcestis";
const EUM = "greek-story-aeschylus-eumenides";
const PILOT = "greek-piraeus-pilot";

function arrive(t, place) {
  const vale = t.s.actors.vale;
  vale.place = place;
  if (!vale.visited.includes(place)) vale.visited.push(place);
  return t;
}

const settle = (t, stem, branch) =>
  t
    .talk(`${stem}-first`)
    .take(`${stem}-object`)
    .give(`${stem}-object`, `${stem}-${branch}`);
const available = (t, id) => legalActions(t.s).find((a) => a.choiceId === id);
const receipts = (t) => t.s.packs[PACK].receipts;
const talkChoice = (t, target) =>
  packTalkChoice(t.s, { actor: "vale", target })?.choiceId;
const reload = (world) => decodeSave(encodeSave(world));

function meetElectra(t = traveler(greekStart())) {
  return arrive(t, "greek-argolid-road")
    .take("atreid-record")
    .move("sanctuary")
    .waitFor("ismene")
    .give("atreid-record", "ismene")
    .move("palace", "well", "courtyard", "harbor", "argolid-road", TOMB)
    .talk(ELECTRA)
    .take("tomb-testimony")
    .give("tomb-testimony", ELECTRA);
}

describe("Greek Honey offerings", () => {
  it("makes Electra’s and the Furies’ offerings without requiring Polynices’s burial or sharing a second Honey", () => {
    const t = meetElectra();
    expect(itemCopies(HONEY)).toEqual([HONEY]);
    expect(t.s.packs[PACK].flags["greek-burial-performed"]).toBeUndefined();
    expect(talkChoice(t, ELECTRA)).toBe("greek-electra-tomb-offering");
    t.talk(ELECTRA)
      .act("choose", { choiceId: `${ELECTRA_STOCK}-supply` })
      .take(HONEY);
    expect(receipts(t)["greek-electra-tomb-offering"]).toBeTypeOf("number");
    expect(t.s.items[HONEY].holder).toBe("vale");

    settle(arrive(t, COURT), EUM, "second");
    expect(available(t, `${FURY_STOCK}-supply`)).toBeUndefined();
    expect(talkChoice(t, `${EUM}-second`)).toBe(
      "greek-furies-welcome-offering",
    );
    t.talk(`${EUM}-second`);
    expect(receipts(t)["greek-furies-welcome-offering"]).toBe(t.s.turn);
    expect(t.s.items[HONEY].holder).toBe("vale");
    t.act("eat", { item: HONEY, target: null }).act("choose", {
      choiceId: `${FURY_STOCK}-supply`,
    });
    expect(reload(t.s).items[HONEY].holder).toBe(COURT);
    expect(t.s.items[FURY_STOCK]).toBeUndefined();
    expect(t.s.items[ELECTRA_STOCK]).toBeUndefined();
  });

  it("keeps the grave offering and its original local branch", () => {
    const t = traveler(funeralJourney(greekStart()).buried);
    expect(t.s.actors.vale.place).toBe(GRAVE);
    const offering = "greek-polynices-grave-offering";
    expect(available(t, offering)?.label).toBe("Pour honey at the grave");
    expect(available(t, `${HONEY}-supply`)).toBeUndefined();
    t.act("choose", { choiceId: offering });
    expect(t.s.packs[PACK].flags["greek-polynices-honey-offered"]).toBe(true);
    t.act("choose", { choiceId: `${HONEY}-supply` });
    expect(reload(t.s).items[HONEY].holder).toBe(GRAVE);
  });

  it("upgrades a carried revision 42 Honey portion when the original was dormant", () => {
    const old = meetElectra().s;
    old.packs[PACK].revision = 42;
    const held = { holder: "vale", history: [] };
    old.items[HONEY] = { holder: GRAVE, history: [] };
    old.items[ELECTRA_STOCK] = held;
    old.actors.vale.heldItem = ELECTRA_STOCK;
    old.usedUp = old.usedUp.filter((id) => id !== HONEY);

    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated.items[HONEY]).toEqual(held);
    expect(migrated.items[ELECTRA_STOCK]).toBeUndefined();
    expect(migrated.actors.vale.heldItem).toBe(HONEY);
  });
});

describe("Greek Olive Oil", () => {
  it("uses the Pherae vigil oil locally while the portable flask remains in hand", () => {
    const t = traveler(greekStart()).take(OIL);
    expect(itemCopies(OIL)).toEqual([OIL]);
    const lampOil = structuredClone(t.s.items.oil);
    settle(arrive(t, PHERAE), ALC, "first");
    const servant = `${ALC}-first`;
    expect(talkChoice(t, servant)).toBe("greek-pherae-tend-vigil-lamp");
    t.talk(servant);
    expect(t.s.actors[servant].trust.vale).toBeGreaterThanOrEqual(1);
    expect(t.s.items[OIL].holder).toBe("vale");
    expect(t.s.items.oil).toEqual(lampOil);
    expect(t.s.items["greek-pherae-vigil-oil"]).toBeUndefined();
    expect(talkChoice(t, servant)).toBeUndefined();
  });

  it("uses Iphis’s quay oil locally after laying the crafted urn, leaving ritual Oil in Colonus", () => {
    const t = landRoad().move("battlefield", "cithaeron", "eleusis");
    t.give(OIL, "aethra")
      .take("burial-petition")
      .move("athens")
      .trade("burial-petition", "theseus", "olive-branch")
      .move("eleusis")
      .give("olive-branch", "aethra")
      .take(URN)
      .move("athens", QUAY);
    expect(talkChoice(t, PILOT)).not.toBe("greek-piraeus-tend-iphis-lamp");
    t.drop(URN);
    expect(t.s.items[URN].holder).toBe(QUAY);
    expect(t.s.items[OIL].holder).toBe(COLONUS);
    expect(talkChoice(t, PILOT)).toBe("greek-piraeus-tend-iphis-lamp");
    t.talk(PILOT);
    expect(t.s.actors[PILOT].trust.vale).toBeGreaterThanOrEqual(1);
    const saved = reload(t.s);
    expect(saved.items[OIL].holder).toBe(COLONUS);
    expect(saved.items["greek-piraeus-iphis-quay-oil"]).toBeUndefined();
  });
});
