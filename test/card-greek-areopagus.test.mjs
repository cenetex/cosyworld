import { describe, expect, it } from "vitest";
import { claimsIn } from "../v2/card-game/claims.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import {
  entityActive,
  packTalkChoice,
} from "../v2/card-game/pack-registry.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const pack = "greek-drama";
const account = "greek-atreid-account";
const heard = "greek-story-aeschylus-eumenides-heard";
const outcome = "greek-story-aeschylus-eumenides-outcome";
const athena = "greek-story-aeschylus-eumenides-first";
const fury = "greek-story-aeschylus-eumenides-second";
const ballot = "greek-story-aeschylus-eumenides-object";
const judgment = "greek-story-aeschylus-eumenides-record";
const place = "greek-areopagus";
const file = "greek-areopagus-file-atreid-evidence";
const admit = "greek-areopagus-admit-atreid-witnesses";
const order = "greek-areopagus-witness-order";
const tomb = "greek-tomb-testimony";
const deposition = "greek-aeschylean-cassandra-deposition";
const palaceRecord = "greek-story-aeschylus-agamemnon-record";
const palaceRecordClaim = `claim:${pack}:${palaceRecord}:greek-story-aeschylus-agamemnon-second-answer`;
const choices = (t) => t.s.packs[pack].choices;
const receipts = (t) => t.s.packs[pack].receipts;
const hasFileAction = (t) =>
  packTalkChoice(t.s, { actor: "vale", target: athena })?.choiceId === file;

function goToCourt(t = traveler(greekStart())) {
  return t
    .move("courtyard", "well")
    .take("water-jar")
    .move("courtyard")
    .give("water-jar", "baker")
    .take("bread")
    .move("gate")
    .trade("bread", "guard", "decree")
    .move("palace")
    .trade("decree", "creon", "creon-writ")
    .move("gate")
    .waitFor("guard")
    .give("creon-writ", "guard")
    .move("battlefield", "cithaeron", "eleusis", "athens", "acropolis", place);
}

function openAccount(keeper, spot) {
  return traveler(greekStart())
    .move("harbor", "argolid-road")
    .take("atreid-record")
    .move(spot)
    .waitFor(keeper)
    .give("atreid-record", keeper)
    .move("argolid-road");
}

describe("Aeschylean household evidence at the Areopagus", () => {
  it("opens the ordinary hearing independently of any Atreid account", () => {
    const court = goToCourt();
    expect(entityActive(court.s, fury)).toBe(true);
    court.talk(athena);
    expect(choices(court)[account]).toBeUndefined();
    expect(hasFileAction(court)).toBe(false);
    expect(entityActive(court.s, order)).toBe(false);
    court.take(ballot).give(ballot, athena);
    expect(choices(court)[outcome]).toBe("first");
    expect(court.s.usedUp).toContain(ballot);
    expect(claimsIn(judgment, court.s).map(({ text }) => text)).toEqual([
      "Athena cast her stone for Orestes and the Areopagus declared him acquitted.",
    ]);
    court.act("read", { item: judgment });
    expect(
      knowsFact(
        court.s,
        "vale",
        `claim:${pack}:${judgment}:greek-story-aeschylus-eumenides-first-answer`,
      ),
    ).toBe(true);
    expect(receipts(court)[file]).toBeUndefined();
  });

  it("lets a carrier file the real tomb tablet and secure witness space before the ballot", () => {
    const source = openAccount("ismene", "sanctuary")
      .move("argos-tomb")
      .talk("electra-aeschylus")
      .take(tomb);
    const court = goToCourt(source);
    expect(choices(court)[account]).toBe("aeschylus");
    expect(hasFileAction(court.fork().drop(tomb))).toBe(false);
    expect(hasFileAction(court)).toBe(true);

    court.talk(athena);
    expect(receipts(court)[file]).toBe(court.s.turn);
    expect(court.s.packs[pack].flags[heard]).toBeUndefined();
    expect(choices(court)[outcome]).toBeUndefined();
    expect(court.s.items[tomb].holder).toBe("vale");
    expect(court.s.items[order].holder).toBe(place);
    expect(entityActive(court.s, order)).toBe(true);
    expect(hasFileAction(court)).toBe(false);
    expect(claimsIn(order, court.s).map((c) => c.claim)).toEqual([file]);

    expect(
      legalActions(court.s).some((a) => a.kind === "take" && a.item === order),
    ).toBe(false);
    expect(packTalkChoice(court.s, { actor: "vale", target: fury })).toBeNull();
    court.act("read", { item: order });

    const old = structuredClone(court.s);
    old.packs[pack].revision = 40;
    old.items[order].holder = "vale";
    old.actors.vale.heldItem = order;
    court.s = decodeSave(JSON.stringify(old));
    expect(court.s.items[order].holder).toBe(place);
    expect(court.s.actors.vale.heldItem).not.toBe(order);
    expect(packTalkChoice(court.s, { actor: "vale", target: fury })?.choiceId).toBe(admit);
    court.talk(fury);
    expect(receipts(court)[admit]).toBe(court.s.turn);
    expect(choices(court)[outcome]).toBeUndefined();
    expect(court.s.items[order].holder).toBe(place);
    expect(court.s.items["greek-areopagus-waiting-water"]).toBeUndefined();
    expect(court.s.actors[fury].trust.vale).toBe(2);
    expect(claimsIn(order, court.s).map((c) => c.claim)).toEqual([file, admit]);
    court.talk(athena);
    court.take(ballot).give(ballot, fury);
    const world = decodeSave(encodeSave(court.s));
    expect(world.packs[pack].choices[outcome]).toBe("second");
    expect(world.packs[pack].receipts[admit]).toBe(receipts(court)[admit]);
  });

  it("admits a traveler who read Cassandra's palace outcome without carrying her deposition", () => {
    const stem = "greek-story-aeschylus-agamemnon";
    const source = openAccount("ismene", "sanctuary")
      .move("argos-tomb", "argos-palace")
      .talk(`${stem}-first`)
      .take(`${stem}-object`)
      .give(`${stem}-object`, `${stem}-second`);
    expect(entityActive(source.s, deposition)).toBe(true);
    expect(entityActive(source.s, "greek-aeschylean-welcome-seal")).toBe(false);
    source.act("read", { item: palaceRecord });
    expect(knowsFact(source.s, "vale", palaceRecordClaim)).toBe(true);

    const court = goToCourt(source);
    expect(court.hands()).not.toContain(deposition);
    expect(court.hands()).not.toContain(tomb);
    expect(hasFileAction(court)).toBe(true);
    court.talk(athena);
    expect(receipts(court)[file]).toBe(court.s.turn);
    expect(court.s.packs[pack].flags[heard]).toBeUndefined();
    expect(entityActive(court.s, order)).toBe(true);
    expect(court.s.items[order].holder).toBe(place);
    expect(choices(court)[outcome]).toBeUndefined();
  });

  it("lets a reader leave the tomb tablet in Argos and file before either local scene opens", () => {
    const source = openAccount("ismene", "sanctuary")
      .move("argos-tomb")
      .take(tomb)
      .act("read", { item: tomb })
      .drop(tomb);
    const court = goToCourt(source).talk(athena);
    const { flags } = court.s.packs[pack];
    expect(flags["greek-atreid-heard-aeschylus"]).toBeUndefined();
    expect(flags[heard]).toBeUndefined();
    expect(court.s.items[tomb].holder).toBe("greek-argos-tomb");
    expect(receipts(court)[file]).toBe(court.s.turn);
    court.act("read", { item: order }).talk(fury);
    expect(receipts(court)[admit]).toBe(court.s.turn);
    expect(choices(court)[outcome]).toBeUndefined();
  });

  it("keeps the rival palace Electra's testimony outside this filing", () => {
    const rival = "greek-palace-testimony";
    const source = openAccount("creon", "palace")
      .move("mycenae-palace")
      .talk("electra-sophocles")
      .take(rival)
      .act("read", { item: rival });
    expect(knowsFact(source.s, "vale", `claim:${pack}:${rival}:waiting`)).toBe(
      true,
    );

    const court = goToCourt(source).talk(athena);
    expect(choices(court)[account]).toBe("sophocles");
    expect(court.s.items[rival].holder).toBe("vale");
    expect(hasFileAction(court)).toBe(false);
    expect(entityActive(court.s, order)).toBe(false);
  });
});
