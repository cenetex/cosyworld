import { expect, it } from "vitest";
import { characterSheet } from "../v2/card-game/character-sheet.mjs";
import { greekJournal } from "../v2/card-game/greek-journal.mjs";
import { seatActors } from "../v2/card-game/human-cast.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { encodeSave, legalActions, play } from "../v2/card-game/world.mjs";
import { committed, witnessed } from "./fixtures/card-branch-ways.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const known = () => true;
const crag = "greek-scythian-crag";
const prometheus = "greek-story-aeschylus-prometheus-bound";

function visit(world, actor, place) {
  world.actors[actor].place = place;
  if (!world.actors[actor].visited.includes(place)) world.actors[actor].visited.push(place);
  return world;
}

it("keeps the world result separate from each traveler's own evidence", () => {
  const t = traveler(visit(greekStart(), "vale", crag));
  expect(characterSheet(t.s, { known }).greek).toEqual([]);
  t.talk(`${prometheus}-first`);
  expect(characterSheet(t.s, { known }).greek).toEqual([
    expect.objectContaining({
      title: "Prometheus Bound",
      personal: "You heard an account.",
      settled: false,
      next: "Send Io with the directions or Mark the fork for later travelers",
    }),
  ]);
  t.act("choose", { choiceId: `${prometheus}-second-answer` });
  expect(greekJournal(t.s, "vale", known)[0]).toMatchObject({ personal: "You took part.", settled: true });
  expect(greekJournal(t.s, "mara", known)).toEqual([]);

  const record = `${prometheus}-record`;
  const shared = dispatchShared({ op: "create", save: encodeSave(t.s) });
  expect(shared.ok, shared.error).toBe(true);
  const late = visit(shared.world, "mara", crag);
  seatActors(late, ["vale", "mara"], ["vale", "mara"]);
  late.playerActorId = "mara";
  expect(greekJournal(late, "mara", (id) => id !== record)).toEqual([]);
  expect(characterSheet(late, { known }).greek[0]).toMatchObject({
    personal: "", settled: true, next: "Read Prometheus Bound Settlement",
  });
  const read = legalActions(late, "mara").find((action) => action.kind === "read" && action.item === record);
  const result = play(late, read, late.revision, "mara");
  expect(result.ok).toBe(true);
  const before = encodeSave(result.state);
  expect(characterSheet(result.state, { known }).greek[0]).toMatchObject({ personal: "You read a record.", settled: true });
  expect(encodeSave(result.state)).toBe(before);
});

it("names a Helen account only after personal evidence, without listing its undiscovered destination", () => {
  expect(greekJournal(committed("egypt"), "vale", known).some(({ title }) => title === "Helen")).toBe(false);
  const rows = greekJournal(witnessed("troy"), "vale", known);
  expect(rows.find(({ title }) => title === "Helen")).toMatchObject({ account: "Trojan account" });
  expect(JSON.stringify(rows)).not.toMatch(/Proteus|Homecoming Beach|Egyptian account/);
});

it("offers a letter handoff only at a personally known destination and character", () => {
  const yard = "greek-argive-jury", tauris = "greek-tauris";
  const electra = "greek-story-euripides-orestes-first", iphigenia = "greek-story-euripides-tauris-first";
  const letter = "greek-story-euripides-tauris-object", order = "greek-story-euripides-tauris-record";
  const t = traveler(visit(greekStart(), "vale", yard)).talk(electra);
  visit(t.s, "vale", tauris);
  t.talk(iphigenia).take(letter).give(letter, iphigenia).act("read", { item: order }).talk(iphigenia);
  const story = (isKnown) => greekJournal(t.s, "vale", isKnown).find(({ title }) => title === "Iphigenia in Tauris");
  expect(story(known).next).toMatch(/Electra.*Jury Yard/);
  expect(story((id) => id !== yard).next).not.toContain("Jury Yard");
  expect(story((id) => id !== electra).next).not.toContain("Electra");
});
