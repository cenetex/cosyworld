import { atticOpening } from "./fixtures/card-attic-opening.mjs";
import { describe, it, expect } from "vitest";
import { legalActions, play } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  actionCaption,
  beatSummary,
  groupBeats,
  memoryVisits,
  sceneBeats,
  withPending,
} from "../v2/card-game/beats.mjs";

// A small hand-written log: Vale arrives at the pond, Pip is there.
let seq = 0;
const event = (fields) => ({ seq: ++seq, turn: 1, ...fields });
const said = (actorId, text, fields = {}) =>
  event({
    kind: "dialogue",
    generated: true,
    actorId,
    entityId: actorId,
    speaker: actorId === "moth" ? "Pip" : "Vale",
    text,
    locationId: "pond",
    ...fields,
  });
const did = (actorId, verb, fields = {}) =>
  event({
    kind: "action",
    speaker: "World",
    text: `${actorId} ${verb}`,
    actorId,
    verb,
    fromLocationId: "pond",
    locationId: "pond",
    witnesses: ["vale", "moth"],
    ...fields,
  });
const worldOf = (log, place = "pond") => ({
  turn: 1,
  log,
  actors: { vale: { place }, moth: { place: "pond" } },
  playerActorId: "vale",
});

describe("beat grouping", () => {
  it("joins a speaker's line with their own actions that turn", () => {
    seq = 0;
    const log = [
      did("vale", "give", {
        targetId: "moth",
        itemId: "lamp",
        accepted: false,
      }),
      did("moth", "move", { locationId: "clearing" }),
      said("moth", "I'm getting out of here."),
      said("vale", "Wait!"),
    ];
    const beats = sceneBeats(worldOf(log));
    expect(beats.map((b) => [b.speakerId, b.line?.text])).toEqual([
      ["moth", "I'm getting out of here."],
      ["vale", "Wait!"],
    ]);
    expect(beats[0].actions.map((a) => `${a.icon} ${a.text}`)).toEqual([
      "➜ Pip left for Forest Clearing.",
    ]);
    expect(beats[1].actions.map((a) => `${a.icon} ${a.text}`)).toEqual([
      "⇄ Vale offered the Lamp to Pip, but Pip refused.",
    ]);
  });

  it("makes an action with no speech its own beat, before that turn's words", () => {
    seq = 0;
    const log = [
      did("moth", "move", { locationId: "clearing" }),
      did("vale", "take", { itemId: "lamp" }),
      said("vale", "Mine now."),
    ];
    const beats = sceneBeats(worldOf(log));
    expect(beats.map((b) => b.key)).toEqual(["a:1:moth", "s:3"]);
    expect(beats[0].line).toBeNull();
    expect(beatSummary(beats[0]).text).toBe("➜ Pip left for Forest Clearing.");
    expect(beatSummary(beats[1]).text).toBe(
      "“Mine now.” ✋ Vale took the Lamp.",
    );
  });

  it("keeps a silent speaker's beat as …", () => {
    seq = 0;
    const log = [
      did("vale", "talk", { targetId: "moth" }),
      said("vale", "Hello?"),
      said("moth", "…", { silent: true }),
    ];
    const beats = sceneBeats(worldOf(log));
    expect(beats).toHaveLength(2);
    expect(beats[1]).toMatchObject({ speakerId: "moth", silent: true });
    expect(beatSummary(beats[1]).speech).toBe("…");
    // Talk is the speech itself, never a caption.
    expect(beats[0].actions).toEqual([]);
  });

  it("shows only what happened at the viewer's place during this visit", () => {
    seq = 0;
    const log = [
      said("moth", "Old words at the pond."),
      did("vale", "move", { fromLocationId: "pond", locationId: "attic" }),
      said("vale", "Up in the attic.", { locationId: "attic" }),
      did("vale", "move", { fromLocationId: "attic", locationId: "pond" }),
      did("mara", "take", {
        itemId: "oil",
        fromLocationId: "clearing",
        locationId: "clearing",
        witnesses: ["mara"],
      }),
      did("moth", "drop", { itemId: "bell", witnesses: ["moth"] }),
      did("moth", "light", { itemId: "lamp" }),
      said("moth", "Back again?"),
    ];
    const beats = sceneBeats(worldOf(log));
    // Earlier visits, other places and unwitnessed acts stay out of the stack.
    expect(beats.map((b) => b.key)).toEqual(["s:8"]);
    expect(beats[0].actions.map((a) => a.text)).toEqual(["Pip lit the Lamp."]);
    // Memory keeps every visit, newest first.
    const visits = memoryVisits(worldOf(log));
    expect(visits.map((v) => v.placeId)).toEqual(["pond", "attic", "pond"]);
    expect(visits.at(-1).beats[0].line.text).toBe("Old words at the pond.");
    // Each remembered visit closes with how the viewer left it.
    expect(visits.at(-1).beats.at(-1).actions[0].text).toBe(
      "Vale left for Mirror attic.",
    );
  });

  it("names who followed the viewer and who arrived another way", () => {
    seq = 0;
    const log = [
      did("vale", "move", { fromLocationId: "attic", locationId: "pond" }),
      did("moth", "move", { fromLocationId: "attic", locationId: "pond" }),
      did("mara", "move", { fromLocationId: "clearing", locationId: "pond" }),
    ];
    const beats = sceneBeats(worldOf(log));
    expect(beats.flatMap((b) => b.actions.map((a) => a.text))).toEqual([
      "Pip followed from Mirror attic.",
      "Mara arrived from Forest Clearing.",
    ]);
  });

  it("holds back a combat step until its stage beat lands", () => {
    seq = 0;
    const log = [
      did("moth", "attack", {
        targetId: "vale",
        damage: 1,
        resolveBefore: 2,
        resolveAfter: 1,
        outcome: "hit",
      }),
    ];
    expect(sceneBeats(worldOf(log), { held: new Set([1]) })).toEqual([]);
    const [beat] = sceneBeats(worldOf(log));
    expect(beatSummary(beat).text).toBe(
      "⚔ Pip struck Vale. Vale staggered back.",
    );
  });

  it("words every caption as a short sentence from the event fields", () => {
    const say = (entry, viewer = "moth") =>
      actionCaption({ seq: 2, turn: 1, ...entry }, { viewer, here: "pond" })
        ?.text;
    const by = (actorId, verb, fields) => ({
      actorId,
      verb,
      locationId: "pond",
      ...fields,
    });
    expect(
      say(
        by("moth", "ask", {
          targetId: "vale",
          itemId: "lamp",
          accepted: false,
        }),
      ),
    ).toBe("Pip asked Vale for the Lamp, but was refused.");
    expect(
      say(
        by("vale", "trade", {
          targetId: "keeper",
          itemId: "cloth",
          receiveId: "oil",
          accepted: false,
        }),
      ),
    ).toBe(
      "Vale offered the Black cloth for the Oil flask, but the keeper refused.",
    );
    expect(
      say(
        by("keeper", "move", { fromLocationId: "pond", locationId: "attic" }),
      ),
    ).toMatch(/^The keeper left for .+\.$/u);
    const hit = (damage, outcome = "hit") =>
      say(by("moth", "attack", { targetId: "vale", damage, outcome }));
    expect(hit(1)).toBe("Pip struck Vale. Vale stumbled.");
    expect(hit(2)).toBe("Pip struck Vale. Vale fell.");
    expect(hit(4)).toBe("Pip struck Vale. Vale took a big hit.");
    expect(hit(1, "guarded")).toBe(
      "Pip struck Vale. Vale braced and took only a glancing blow.",
    );
    expect(hit(2, "yield")).toBe("Pip struck Vale. Vale gave way.");
    expect(
      say(
        by("vale", "sent-home", {
          fromLocationId: "pond",
          locationId: "attic",
        }),
      ),
    ).toBe("Vale was beaten and sent home.");
    expect(say(by("vale", "use", { text: "Vale found the Lamp" }))).toBe(
      "Vale found the Lamp.",
    );
  });

  it("folds the waiting speaker's actions into the Thinking card", () => {
    seq = 0;
    const log = [
      did("vale", "give", { targetId: "moth", itemId: "lamp", accepted: true }),
      did("moth", "light", { itemId: "lamp" }),
    ];
    const { beats, pending } = withPending(sceneBeats(worldOf(log)), {
      speakerId: "moth",
      turn: 1,
    });
    expect(beats.map((b) => b.speakerId)).toEqual(["vale"]);
    expect(pending.actions.map((a) => a.text)).toEqual(["Pip lit the Lamp."]);
  });

  it("hides speech the exchange has not reached", () => {
    seq = 0;
    const log = [said("vale", "One."), said("moth", "Two.")];
    const beats = groupBeats(log, {
      viewer: "vale",
      here: "pond",
      hiddenSpeech: (line) => line.seq > 1,
    });
    expect(beats.map((b) => b.line.text)).toEqual(["One."]);
  });
});

describe("shared reading clock", () => {
  it("keeps a queued later turn's actions back until its scene is read", () => {
    seq = 0;
    const log = [
      said("vale", "First."),
      did("moth", "take", { itemId: "bell", turn: 2 }),
      said("moth", "Second.", { turn: 2 }),
    ];
    const beats = groupBeats(log, {
      viewer: "vale",
      here: "pond",
      shared: true,
      hiddenSpeech: (line) => line.seq > 1,
      hiddenAction: (entry) => entry.turn > 1,
    });
    expect(beats.map((b) => b.key)).toEqual(["s:1"]);
  });
});

describe("combat beats from the rules", () => {
  const act = (s, kind, target) => {
    const action = legalActions(s).find(
      (a) => a.kind === kind && (!target || a.target === target),
    );
    expect(action, kind).toBeTruthy();
    const result = play(s, action);
    expect(result.ok, result.error).toBe(true);
    return result.state;
  };
  it("gives each fighter a beat and the loser the defeat", () => {
    let s = enableMotives(atticOpening());
    s = act(s, "snuff");
    s.actors.moth.place = "pond";
    s = act(s, "move", "pond");
    s.standoffs = [
      {
        challenger: "moth",
        defender: "vale",
        location: "pond",
        item: "lamp",
        opened: s.turn - 1,
        answered: true,
        resolve: { vale: 1, moth: 4 },
        guarding: { vale: false, moth: false },
        struck: { vale: true, moth: true },
        steppedBack: { vale: false, moth: false },
      },
    ];
    const before = s.log.length;
    const after = act(s, "guard", "moth");
    const fresh = after.log.slice(before);
    const beats = groupBeats(fresh, { viewer: "vale", here: "pond" });
    const text = beats.map((b) => [b.speakerId, b.actions.map((a) => a.text)]);
    // Each fighter's step is a beat; the defeat follows on the loser's beat.
    expect(text).toEqual([
      ["vale", ["Vale braced against Pip."]],
      ["moth", ["Pip struck Vale. Vale gave way."]],
      [
        "vale",
        [
          expect.stringMatching(
            /^Vale was beaten and (sent home|fell back to )/u,
          ),
        ],
      ],
    ]);
    // Vale lost and came to elsewhere: the new visit opens on that.
    const [arrival] = sceneBeats(after);
    expect(arrival.speakerId).toBe("vale");
    expect(arrival.actions[0].icon).toBe("↳");
    expect(arrival.actions[0].text).toMatch(/^You came to at /u);
    // From the pond, the same defeat is on the loser's beat.
    const leaving = actionCaption(
      fresh.find((e) => ["retreat", "sent-home"].includes(e.verb)),
      { viewer: "moth", here: "pond" },
    );
    expect(leaving.text).toMatch(
      /^Vale was beaten and (sent home|fell back to )/u,
    );
  });
});
