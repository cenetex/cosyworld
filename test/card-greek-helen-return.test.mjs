import { describe, expect, it } from "vitest";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { lanePath } from "../v2/card-game/pack-transport.mjs";
import { decodeSave, encodeSave, exits } from "../v2/card-game/world.mjs";
import { openGreekGate } from "./helpers/greek-gate.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";

const pack = "greek-drama";
const harbor = "greek-harbor";
const scylla = "greek-scylla";
const pagasae = "greek-pagasae";
const egypt = "greek-egypt-tomb";
const mark = "greek-helen-egypt-passage-mark";
const notice = "greek-helen-pagasae-report";
const report = "greek-helen-egypt-report-pagasae";
const troyHelen = "greek-helen-troy";
const wine = "greek-wine-skin";
const oldShelterWine = "greek-helen-troy-shelter-wine";

const reload = (world) => decodeSave(encodeSave(world));
const sail = (t, destination) =>
  t
    .act("move", { target: scylla })
    .act("course", { target: destination })
    .act("wait")
    .act("move", { target: destination });

describe("Helen’s passage records", () => {
  it("carries the Egyptian passage mark back on Scylla and posts it at Pagasae", () => {
    const t = traveler(openGreekGate(greekStart())).move(harbor);
    t.take("helen-accounts").give("helen-accounts", "shipmaster");
    expect(t.s.packs[pack].choices["greek-helen-account"]).toBe("egypt");
    expect(exits(t.s, harbor, "vale")).not.toContain(egypt);
    expect(entityActive(t.s, mark)).toBe(false);

    stowProvisions(t.s, harbor);
    t.take("provisions").move(pagasae);
    sail(t, egypt);
    t.act("talk", { target: "greek-helen-egypt" }).take("egypt-testimony");
    t.give("egypt-testimony", "menelaus-egypt");
    expect(t.s.packs[pack].choices["greek-helen-response"]).toBe("passage");
    expect(t.s.usedUp).toContain("greek-provisions");
    expect(t.s.items["greek-egypt-testimony"].holder).toBe(egypt);
    expect(entityActive(t.s, mark)).toBe(true);
    expect(entityActive(t.s, notice)).toBe(false);

    t.take(mark);
    t.s = reload(t.s);
    sail(t, pagasae);
    expect(t.s.items[mark].holder).toBe("vale");
    expect(t.s.actors.vale.visited).not.toContain("greek-ship");
    t.give(mark, "pagasae-pilot");
    expect(t.s.packs[pack].receipts[report]).toBe(t.s.turn);
    expect(t.s.items[mark].holder).toBe(pagasae);
    expect(entityActive(t.s, notice)).toBe(true);
    t.act("read", { item: notice });

    const saved = reload(t.s);
    expect(saved.items[notice].holder).toBe(pagasae);
    expect(knowsFact(saved, "vale", `claim:${pack}:${notice}:${report}`)).toBe(
      true,
    );
  });

  it("keeps the Trojan beach and its shelter apart from the Egyptian voyage", () => {
    const t = traveler(greekStart()).move(harbor).take("helen-accounts");
    t.move("well").give("helen-accounts", "elder").move(harbor);
    expect(t.s.packs[pack].choices["greek-helen-account"]).toBe("troy");
    expect(lanePath(t.s, scylla, pagasae, egypt)).toBeNull();
    t.move("troy-beach").act("talk", { target: troyHelen });
    const gateWine = structuredClone(t.s.items[wine]);
    const oldTrust = t.s.actors[troyHelen].trust.vale ?? 0;
    expect(oldTrust).toBeLessThan(2);
    t.take("troy-testimony").give("troy-testimony", troyHelen);
    expect(t.s.packs[pack].choices["greek-helen-response"]).toBe("shelter");
    t.take("troy-testimony").act("read", { item: "greek-troy-testimony" });
    const saved = reload(t.s);
    const shelter = `claim:${pack}:greek-troy-testimony:greek-helen-troy-shelter`;
    expect(knowsFact(saved, "vale", shelter)).toBe(true);
    expect(saved.knowledge.facts[shelter]?.text).toContain("shared her wine");
    expect(saved.actors[troyHelen].trust.vale).toBe(2);
    expect(saved.items[wine]).toEqual(gateWine);
    expect(saved.items[oldShelterWine]).toBeUndefined();

    const old = structuredClone(t.s);
    old.packs[pack].revision = 42;
    old.actors[troyHelen].trust.vale = oldTrust;
    old.items[oldShelterWine] = { holder: "greek-troy-beach", history: [] };
    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated.actors[troyHelen].trust.vale).toBe(2);
    expect(migrated.items[oldShelterWine]).toBeUndefined();
    expect(knowsFact(migrated, "vale", shelter)).toBe(true);

    expect(entityActive(t.s, mark)).toBe(false);
    expect(entityActive(t.s, notice)).toBe(false);
    t.move(harbor);
    expect(t.s.actors.vale.place).toBe(harbor);
  });

  it("records the Trojan passage and spent provisions in the original tablet", () => {
    const t = traveler(greekStart()).move(harbor).take("helen-accounts");
    t.move("well").give("helen-accounts", "elder").move(harbor);
    stowProvisions(t.s, harbor);
    t.take("provisions").move("troy-beach").talk("helen-troy");
    t.take("troy-testimony").give("troy-testimony", "menelaus-troy");
    expect(t.s.usedUp).toContain("greek-provisions");
    expect(t.s.items["greek-troy-testimony"].holder).toBe("greek-troy-beach");
    expect(t.s.items["greek-helen-troy-return-tally"]).toBeUndefined();
    t.take("troy-testimony").act("read", { item: "greek-troy-testimony" });
    const saved = reload(t.s);
    const passage = `claim:${pack}:greek-troy-testimony:greek-helen-troy-passage`;
    const shelter = `claim:${pack}:greek-troy-testimony:greek-helen-troy-shelter`;
    expect(knowsFact(saved, "vale", passage)).toBe(true);
    expect(saved.knowledge.facts[passage]?.text).toBe(
      "At the Homecoming Beach, Menelaus agreed to passage and kept the tablet at the beach while the Travel Provisions were spent.",
    );
    expect(knowsFact(saved, "vale", shelter)).toBe(false);
  });
});
