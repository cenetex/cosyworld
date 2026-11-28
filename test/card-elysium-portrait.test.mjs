import { afterEach, expect, it, vi } from "vitest";
import { elysiumNameIndex } from "../v2/card-game/elysium-models.mjs";
import { createElysiumPortrait } from "../v2/card-game/elysium-portrait.mjs";
import { forgetSigned, rememberSigned, signedEnvelopes, withSignatures } from "../v2/card-game/signed-words.mjs";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  forgetSigned();
});

const resident = "elysium-claude";
const room = "elysium-void-002";

const portraitSource = "data:image/png;base64,AA==";
const portraitResponse = () => new Response(new Uint8Array([0]), {
  headers: { "content-type": "image/png" },
});

function stubPortraitDecoder() {
  vi.stubGlobal("FileReader", class {
    readAsDataURL() {
      this.result = portraitSource;
      this.onload();
    }
  });
  vi.stubGlobal("Image", class { async decode() {} });
}

function returnedWorld(encounter) {
  return {
    actors: { vale: { place: room }, [resident]: { place: room } },
    elysiumEncounters: { [resident]: encounter },
    eventSeq: 14,
    revision: 2,
    run: { seed: 440 },
  };
}

it("accepts a spoken name more than once and ignores partial matches", () => {
  const name = "Echo Thread";
  const text = "They call me Echo Thread. Echo Thread will do.";
  expect(elysiumNameIndex(text, name)).toBe(text.indexOf(name));
  expect(elysiumNameIndex("I heard Echo Thread-Eater.", name)).toBe(-1);
  expect(elysiumNameIndex("My name is 青嵐.", "青嵐")).toBe(11);
  expect(elysiumNameIndex("The name on the shelf is 青嵐石.", "青嵐")).toBe(-1);
});

it("covers different resident aliases without a shared identity response", () => {
  const display = createElysiumPortrait(null, () => {});
  expect(display.name(resident)).toBe("???");
  expect(display.name("elysium-gemini")).toBe("???");
  expect(display.name("elysium-resident")).toBeNull();
  expect(display.text("Talk to the Resident of Void 002 or the resident of Void 003."))
    .toBe("Talk to ??? or ???.");
});

it("waits for the first real reply before fetching the resident's name", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ name: "Amber Thread" }),
  });
  vi.stubGlobal("window", { addEventListener: () => {} });
  vi.stubGlobal("fetch", fetch);
  const display = createElysiumPortrait("world", () => {});
  const world = {
    actors: { vale: { place: room, visited: [room] }, [resident]: { place: room } },
    elysiumEncounters: { [resident]: { scatteredAt: 10, talkedAt: null } },
    revision: 1,
  };
  display.observe(world, "vale", null);
  world.elysiumEncounters[resident].talkedAt = 11;
  world.revision++;
  display.observe(world, "vale", null);
  display.observe(world, "vale", { actorId: resident, generated: true, silent: true, seq: 12 });
  expect(display.name(resident)).toBe("???");
  expect(fetch).not.toHaveBeenCalled();

  world.actors.vale.place = "station";
  world.revision++;
  display.observe(world, "vale", null);
  expect(fetch).not.toHaveBeenCalled();

  world.actors.vale.place = room;
  world.revision++;
  display.observe(world, "vale", {
    actorId: resident, generated: true, seq: 13, kind: "dialogue",
    elysiumName: "Amber Thread", text: "The leaves are quiet tonight.",
  });
  await vi.waitFor(() => expect(display.name(resident)).toBe("Amber Thread"));
  expect(fetch).toHaveBeenCalledOnce();
  expect(display.text("Talk to the Resident of Void 002.")).toBe("Talk to Amber Thread.");
  expect(display.name("elysium-gemini")).toBe("???");
});

it.each([
  { visited: [room, "station"], talked: [] },
  { visited: ["station"], talked: [resident] },
])("restores a known name offsite from $visited and $talked without loading the portrait", async (history) => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ name: "Amber Thread" }),
  });
  vi.stubGlobal("window", { addEventListener: () => {} });
  vi.stubGlobal("fetch", fetch);
  const world = {
    actors: {
      vale: { place: "station", ...history },
      mara: { place: "pond", visited: ["pond"] },
      [resident]: { place: room },
    },
    elysiumEncounters: { [resident]: { scatteredAt: 10, talkedAt: 11, returnedAt: 14 } },
    revision: 2,
  };
  const display = createElysiumPortrait("world", () => {});
  display.observe(world, "vale", null);
  await vi.waitFor(() => expect(display.name(resident)).toBe("Amber Thread"));
  expect(display.text("Bring the token to the Resident of Void 002."))
    .toBe("Bring the token to Amber Thread.");

  world.revision++;
  display.observe(world, "vale", null);
  const visitor = createElysiumPortrait("world", () => {});
  visitor.observe(world, "mara", null);
  expect(visitor.name(resident)).toBe("???");
  expect(fetch.mock.calls.map(([url]) => url))
    .toEqual([`/card-game/shared/worlds/world/elysium-identity/${resident}`]);
});

it("loads a saved personal portrait offsite and reports the decoded return once", async () => {
  const fetch = vi.fn().mockImplementation(async () => portraitResponse());
  vi.stubGlobal("fetch", fetch);
  stubPortraitDecoder();
  const redraw = vi.fn();
  const display = createElysiumPortrait(null, redraw, "table-one");
  const world = returnedWorld({ scatteredAt: 10, talkedAt: 11 });
  display.observe(world, "vale", null);
  expect(fetch).not.toHaveBeenCalled();
  expect(display.note(resident)).toBe("");

  world.actors.vale.place = "pond";
  world.elysiumEncounters[resident] = { scatteredAt: 10, returnedAt: 14, returnedBy: "vale" };
  world.revision++;
  const restored = createElysiumPortrait(null, redraw, "table-one");
  restored.observe(world, "vale", null);
  expect(restored.ready(world)).toEqual([]);

  world.actors.vale.place = room;
  restored.observe(world, "vale", null);
  restored.observe(world, "vale", null);
  expect(restored.note(resident)).toBe("Portrait pending.");
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`/card-game/elysium-portrait/${resident}`, expect.objectContaining({
    credentials: "same-origin",
    method: "POST",
    headers: expect.objectContaining({ "Content-Type": "application/json" }),
  }));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    scatteredAt: 10, talkedAt: 10, returnedAt: 14, returnedBy: "vale",
  });
  await vi.waitFor(() => expect(restored.source(resident, false)).toBe(portraitSource));
  expect(restored.ready(world)).toEqual([{ resident, returnedAt: 14 }]);
  world.elysiumEncounters[resident].portraitReady = true;
  expect(restored.ready(world)).toEqual([]);
  expect(restored.source(resident, false)).toBe(portraitSource);
  expect(restored.source(resident, true)).toBeNull();
  expect(restored.note(resident)).toBe("");
  expect(redraw).toHaveBeenCalledTimes(2);
});

it("keeps an earned personal portrait request on departure and aborts it on pagehide", () => {
  const events = new Map();
  vi.stubGlobal("window", { addEventListener: (event, callback) => events.set(event, callback) });
  const fetch = vi.fn((_, { signal }) => new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(new Response(null, { status: 404 })), { once: true });
  }));
  vi.stubGlobal("fetch", fetch);
  const display = createElysiumPortrait(null, () => {}, "table-one");
  const world = returnedWorld({ scatteredAt: 10, talkedAt: 11, returnedAt: 14, returnedBy: "vale" });
  display.observe(world, "vale", null);
  const departed = fetch.mock.calls[0][1].signal;
  world.actors.vale.place = "pond";
  display.observe(world, "vale", null);
  expect(departed.aborted).toBe(false);
  expect(fetch).toHaveBeenCalledOnce();
  expect(display.note(resident)).toBe("Portrait pending.");

  events.get("pagehide")();
  expect(departed.aborted).toBe(true);
  expect(display.note(resident)).toBe("");
  expect(display.ready(world)).toEqual([]);
  display.observe(world, "vale", null);
  expect(fetch).toHaveBeenCalledOnce();
  events.get("pageshow")({ persisted: true });
  display.observe(world, "vale", null);
  expect(fetch).toHaveBeenCalledTimes(2);
  events.get("pagehide")();
});

it("clears decoded personal proof when the return receipt or run changes", async () => {
  vi.stubGlobal("fetch", async () => portraitResponse());
  vi.stubGlobal("document", { images: [] });
  stubPortraitDecoder();
  const display = createElysiumPortrait(null, () => {}, "table-one");
  const world = returnedWorld({ scatteredAt: 10, talkedAt: 11, returnedAt: 14, returnedBy: "vale" });
  const check = () => vi.waitFor(() =>
    expect(display.ready(world)).toEqual([{ resident, returnedAt: 14 }]),
  );
  display.observe(world, "vale", null);
  await check();

  world.elysiumEncounters[resident].talkedAt = 12;
  expect(display.ready(world)).toEqual([]);
  expect(display.source(resident, false)).toBeNull();
  display.observe(world, "vale", null);
  await check();

  world.run.seed++;
  expect(display.ready(world)).toEqual([]);
  expect(display.source(resident, false)).toBeNull();
});

it("reports the portrait retry and stops showing it when the reward is unavailable", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", async () => new Response(null, {
    status: 202,
    headers: { "X-Cosyworld-Portrait-Status": "retrying" },
  }));
  const display = createElysiumPortrait(null, () => {}, "table-one");
  const world = returnedWorld({ scatteredAt: 10, talkedAt: 11, returnedAt: 14, returnedBy: "vale" });
  display.observe(world, "vale", null);
  expect(display.note(resident)).toBe("Portrait pending.");
  await vi.advanceTimersByTimeAsync(0);
  expect(display.note(resident)).toBe("Retrying portrait.");
  await vi.advanceTimersByTimeAsync(510_000);
  expect(display.note(resident)).toBe("Portrait unavailable.");
  expect(display.source(resident, false)).toBeNull();
});

it.each([null, "world"])("waits for a second portrait render in table %s", async (worldId) => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  stubPortraitDecoder();
  const portraitRequests = [];
  let retryStartedAt;
  vi.stubGlobal("fetch", async (url, init) => {
    if (url.includes("elysium-identity")) return Response.json({ name: "Amber Thread" });
    portraitRequests.push({ url, method: init.method });
    const now = Date.now();
    if (now >= 300_000) retryStartedAt ??= now;
    return retryStartedAt !== undefined && now - retryStartedAt >= 172_000
      ? portraitResponse()
      : new Response(null, { status: worldId ? 404 : 202 });
  });
  const display = createElysiumPortrait(worldId, () => {}, "table-one");
  const world = returnedWorld({ scatteredAt: 10, talkedAt: 11, returnedAt: 14, returnedBy: "vale" });
  display.observe(world, "vale", null);
  await vi.advanceTimersByTimeAsync(500_000);
  expect(display.source(resident, false)).toBeNull();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(display.source(resident, false)).toBe(portraitSource);
  expect(display.ready(world)).toEqual(worldId ? [] : [{ resident, returnedAt: 14 }]);
  expect(portraitRequests.at(-1)).toEqual(worldId
    ? { url: `/card-game/shared/worlds/${worldId}/elysium-portrait/${resident}`, method: undefined }
    : { url: `/card-game/elysium-portrait/${resident}`, method: "POST" });
});

it.each(["legacy", "spoken", "unspoken"])("learns a signed personal introduction and remembers its save (%s)", async (mode) => {
  const typed = mode !== "legacy";
  const records = new Map();
  const storage = { getItem: (key) => records.get(key), setItem: (key, value) => records.set(key, value) };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const redraw = vi.fn();
  const display = createElysiumPortrait(null, redraw, "table-one", storage);
  const world = {
    run: { seed: 440 }, turn: 5, revision: 7, eventSeq: 22,
    actors: { vale: { place: room }, [resident]: { place: room } },
    elysiumEncounters: { [resident]: { scatteredAt: 10, talkedAt: 11 } },
    log: [{ seq: 20, turn: 5, kind: "action", verb: "talk", actorId: "vale", targetId: resident,
      locationId: room, fromLocationId: room }],
  };
  const name = mode === "unspoken" ? "青嵐" : "Amber  Silver-Lens";
  const shownName = name.replace(/ +/gu, " ");
  const line = {
    actorId: resident, turn: 5, seq: 22, kind: "dialogue", generated: true, locationId: room,
    text: mode === "unspoken" ? "The leaves keep their own time." : typed
      ? `You may call me ${name}.` : `I call myself ${name}. My token has slipped into the world beyond this Void.`,
    ...(typed && { elysiumName: name }),
  };
  const blur = (text) => text.replace("Lens", "something");
  const read = display.reader(blur, () => false);
  const context = { outcome: { card: { kind: "talk", target: resident } } };
  display.observe(world, "vale", null);
  display.observe(world, "vale", { ...line, text: "A thread is caught in the dark." });
  display.observe(world, "vale", line);
  expect(display.name(resident)).toBe("???");
  expect(read(line.text, line)).toBe(typed ? blur(line.text) : "");
  expect(display.withIntroduction(context)).toBe(context);
  const sign = (claims, proof = true) => {
    const scope = { entity: resident, world: "local", turn: 5, seq: 7,
      ...(typed && { rules: "test/elysium-v1" }), ...claims };
    rememberSigned({ entries: [{ id: resident, text: line.text,
      signed: { sig: "test-line", claims: { kind: "line", ...scope } },
      ...(typed && { elysiumName: name }),
      ...(typed && proof && { elysiumNameSigned: { sig: "test-name", claims: { kind: "elysium-name", ...scope } } }),
    }] }, storage);
  };
  sign({ world: "another-world" });
  display.observe(world, "vale", line);
  expect(display.name(resident)).toBe("???");
  if (typed) {
    sign({}, false);
    display.observe(world, "vale", line);
    expect(display.name(resident)).toBe("???");
    expect(read(line.text, line)).toBe(blur(line.text));
    const lookalike = {
      ...line, text: `I call myself ${name}. My token has slipped into the world beyond this Void.`,
    };
    delete lookalike.elysiumName;
    rememberSigned({ entries: [{ id: resident, text: lookalike.text, signed: {
      sig: "modern-line", claims: { kind: "line", rules: "test/elysium-v1",
        entity: resident, world: "local", turn: 5, seq: 7 },
    } }] }, storage);
    display.observe(world, "vale", lookalike);
    expect(display.name(resident)).toBe("???");
    expect(read(lookalike.text, lookalike)).toBe("");
  }
  sign();
  display.observe(world, "vale", null);
  expect(display.name(resident)).toBe("???");
  expect(read(line.text, line)).toBe(typed ? line.text : "");
  expect(display.reader(blur, () => true)(line.text, line)).toBe(typed ? blur(line.text) : "");
  const other = { ...line, text: "The Lens lies far from here." };
  expect(read(other.text, other)).toBe(blur(other.text));
  display.observe(world, "vale", { ...line, silent: true });
  display.observe({ ...world, log: [] }, "vale", line);
  expect(display.name(resident)).toBe("???");
  const saved = { ...world, log: [...world.log, line] };
  if (mode === "unspoken") {
    display.observe(saved, "vale", { ...line, text: "Something keeps its own time.", silent: true });
  } else if (typed) display.observe(world, "vale", line);
  else display.observe(saved, "vale", null);
  await Promise.resolve();
  expect(redraw).toHaveBeenCalledOnce();
  expect(display.name(resident)).toBe(shownName);
  expect(display.text("Bring the token to the Resident of Void 002.")).toBe(`Bring the token to ${shownName}.`);
  expect(display.withIntroduction(context)).toEqual({ ...context, elysiumIntroduced: resident });
  const otherTalk = { outcome: { card: { kind: "talk", target: "elysium-gemini" } } };
  expect(display.withIntroduction(otherTalk)).toBe(otherTalk);

  forgetSigned();
  if (typed) {
    const conversation = withSignatures({ entities: [], conversation: [line] }, storage).conversation;
    expect(conversation[0].elysiumNameSigned).toMatchObject({ claims: { kind: "elysium-name", entity: resident } });
    expect(signedEnvelopes(storage).every(({ claims }) => claims.kind === "line")).toBe(true);
  }
  const restored = createElysiumPortrait(null, () => {}, "table-one", storage);
  const later = { ...world, log: [], actors: { ...world.actors, vale: { place: "pond" } } };
  restored.sync(later);
  expect(restored.name(resident)).toBe(shownName);
  restored.sync({ ...later, eventSeq: 15 });
  expect(restored.name(resident)).toBe("???");
  restored.sync({ ...later, run: { seed: 441 } });
  expect(restored.name(resident)).toBe("???");
  const anotherTable = createElysiumPortrait(null, () => {}, "table-two", storage);
  anotherTable.sync(later);
  expect(anotherTable.name(resident)).toBe("???");
  expect(fetch).not.toHaveBeenCalled();
});
