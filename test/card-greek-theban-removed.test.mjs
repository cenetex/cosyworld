import { describe, expect, it } from "vitest";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";

const pack = packDefinition("greek-drama");

// The archived Theban-response branch (report, permitted burial, courtyard
// reports, the Guard's Tablet) went with the rules 133 bump
// (docs/design/wants-and-arcs.md). Nothing may write or read what only it did.
const GONE_CHOICES = [
  "greek-prepare-burial-ground",
  "greek-perform-burial",
  "greek-petition-burial",
  "greek-perform-permitted-burial",
  "greek-report-plan",
  "greek-courtyard-burial",
  "greek-courtyard-concession",
  "greek-courtyard-permitted-burial",
  "greek-courtyard-exposure",
];
const GONE_KEYS = [
  "greek-theban-response",
  "greek-guard-warned",
  "greek-grave-prepared",
  "greek-burial-permitted",
  "greek-burial-public",
  "greek-concession-public",
  "greek-exposure-public",
  "greek-permitted-burial-public",
];

describe("the removed Theban-response branch", () => {
  it("has no choice, item, verse or claim left", () => {
    const ids = new Set(pack.choices.map((c) => c.id));
    for (const id of GONE_CHOICES) expect(ids.has(id), id).toBe(false);
    expect(pack.items["greek-guard-tablet"]).toBeUndefined();
    expect(pack.release.items).not.toContain("greek-guard-tablet");
    for (const id of GONE_CHOICES) {
      expect(pack.release.choices).not.toContain(id);
      expect(pack.recital.verses.some((v) => v.choice === id), id).toBe(false);
      expect(
        pack.recital.claims.some((c) => c.anyChoices.includes(id)),
        id,
      ).toBe(false);
    }
    expect(pack.choices.filter((c) => c.archived)).toEqual([]);
  });

  it("leaves no fact that something reads and nothing writes", () => {
    const text = JSON.stringify(pack);
    for (const key of GONE_KEYS) expect(text, key).not.toContain(key);
    // Generic guard: every flag or choice a condition reads has a writer.
    const written = new Set();
    for (const c of pack.choices)
      for (const e of c.effects || [])
        if (e.key && ["set_flag", "choose"].includes(e.kind)) written.add(e.key);
    const read = new Set();
    const collect = (conditions = []) => {
      for (const c of conditions) {
        if (["flag", "choice", "choice_unset"].includes(c.kind))
          read.add(c.key);
        if (c.conditions) collect(c.conditions);
      }
    };
    for (const c of pack.choices) collect(c.requires);
    for (const r of pack.routes || []) collect(r.requires);
    for (const entity of [
      ...Object.values(pack.avatars),
      ...Object.values(pack.places),
      ...Object.values(pack.items),
    ]) {
      collect(entity.requires);
      collect(entity.appearsWhen);
      collect(entity.sealed?.requires);
    }
    for (const t of pack.topics || []) collect(t.requires);
    for (const s of pack.sections || []) collect(s.requires);
    const unwritten = [...read].filter((k) => !written.has(k));
    expect(unwritten).toEqual([]);
  });
});
