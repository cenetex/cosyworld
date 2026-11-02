import { describe, expect, it, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  forgetSigned,
  rememberSigned,
  signedRequest,
  withSignatures,
} from "../v2/card-game/signed-words.mjs";

const envelope = (n) => ({ v: 1, claims: { kid: "k", seq: n }, sig: `s${n}` });
const memoryStore = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
  };
};
const scene = () => ({
  revision: 5,
  turn: 5,
  speakers: ["vale"],
  conversation: [
    { actorId: "moth", text: "I offered my cloth.", witnesses: ["moth"] },
    { actorId: "keeper", text: "Typed by someone else." },
  ],
  entities: [
    {
      id: "vale",
      facts: ["Holding: Lamp."],
      memories: [
        { seq: 1, turn: 1, kind: "event", text: "World: Vale waits one turn." },
        {
          seq: 2,
          turn: 2,
          kind: "expression",
          text: "Pip: I offered my cloth.",
        },
        { seq: 3, turn: 3, kind: "expression", text: "Pip: Never signed." },
      ],
      previous: "The lamp is warm.",
      inner_life: {
        persona: "I keep the lamp lit.",
        thoughts: [
          { turn: 2, text: "Pip was kind." },
          { turn: 3, text: "Unsigned thought." },
        ],
        dreams: [],
      },
    },
  ],
});

describe("signed words", () => {
  let storage;
  beforeEach(() => {
    forgetSigned();
    storage = memoryStore();
  });

  it("sends remembered words only with the envelope the service gave them", () => {
    rememberSigned(
      {
        entries: [
          { id: "moth", text: "I offered my cloth.", signed: envelope(1) },
          { id: "vale", text: "The lamp is warm.", signed: envelope(2) },
        ],
      },
      storage,
    );
    rememberSigned(
      {
        reflections: [
          {
            id: "vale",
            reflection: {
              thought: "Pip was kind.",
              persona: "I keep the lamp lit.",
            },
            signed: { thought: envelope(3), persona: envelope(4) },
          },
        ],
      },
      storage,
    );
    const sent = withSignatures(scene(), storage);
    expect(sent.conversation).toEqual([
      {
        actorId: "moth",
        text: "I offered my cloth.",
        witnesses: ["moth"],
        signed: envelope(1),
      },
    ]);
    const vale = sent.entities[0];
    expect(vale.previous_signed).toEqual(envelope(2));
    expect(vale.memories.map((m) => m.seq)).toEqual([1, 2]);
    expect(vale.memories[1].signed).toEqual(envelope(1));
    expect(vale.inner_life.persona_signed).toEqual(envelope(4));
    expect(vale.inner_life.thoughts).toEqual([
      { turn: 2, text: "Pip was kind.", signed: envelope(3) },
    ]);
    // A reload reads the kept envelopes back.
    forgetSigned();
    expect(withSignatures(scene(), storage).conversation).toHaveLength(1);
  });

  it("leaves unsigned words out, as an older save's are", () => {
    const sent = withSignatures(scene(), storage);
    expect(sent.conversation).toEqual([]);
    expect(sent.entities[0].previous).toBeNull();
    expect(sent.entities[0].memories.map((m) => m.kind)).toEqual(["event"]);
    expect(sent.entities[0].inner_life).toMatchObject({
      persona: null,
      thoughts: [],
    });
    // Rules facts and events are sent as they are; the service checks them.
    expect(sent.entities[0].facts).toEqual(["Holding: Lamp."]);
  });

  it("wraps a story request", async () => {
    let body;
    const request = signedRequest(async (context) => {
      body = context;
      return {
        entries: [
          { id: "keeper", text: "Typed by someone else.", signed: envelope(9) },
        ],
      };
    });
    await request(scene());
    expect(body.conversation).toEqual([]);
    expect(
      withSignatures(scene()).conversation.map((l) => l.actorId),
    ).toContain("keeper");
  });

  it("keeps the authored text catalog current", () => {
    execFileSync("node", [
      "v2/scripts/build-card-authored-text.mjs",
      "--check",
    ]);
  });
});
