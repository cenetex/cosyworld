import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.mjs";
import { emptyState } from "../src/channel.mjs";
import { createRoom, createStats, record, summary } from "../src/room.mjs";
import { heard } from "../src/turns.mjs";

const config = readConfig({ ORCHESTRATOR_URL: "https://cosyworld.example", DISCORD_COORDINATE_INLINE_MS: "20" });
const cast = [
  { id: "rati", name: "RATi" },
  { id: "vale", name: "Vale" },
  { id: "skull", name: "Skull" },
];
const now = timers();

function timers() {
  return { setTimeout: (fn) => (fn(), 1), clearTimeout: () => {} };
}

function next(choice, p) {
  return { answers: { next: { choice, confidence: p, probabilities: { [choice]: p } } }, reason: "ok" };
}

function odds(probabilities) {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  return { answers: { next: { choice, confidence: probabilities[choice], probabilities } }, reason: "ok" };
}

const village = [...cast, { id: "keeper", name: "Keeper" }, { id: "moth", name: "Moth" }, { id: "oak", name: "Oak" }, { id: "whiskerwind", name: "Whiskerwind" }];
const introductions = { keeper: 0.38, oak: 0.29, rati: 0.08, vale: 0.05, whiskerwind: 0.04, none: 0.12 };

function fixture(answers, extra = {}) {
  const room = createRoom("g1", "c1");
  room.webhookId = "hook";
  const fixed = { room, sent: [], payloads: [], asks: [], logs: [], stats: createStats(), state: emptyState() };
  fixed.deps = {
    config,
    cast,
    state: fixed.state,
    stats: fixed.stats,
    log: (line) => fixed.logs.push(line),
    save: () => {},
    sleep: async () => {},
    coordinate: async (body) => {
      fixed.asks.push(body);
      const answer = answers.shift();
      return typeof answer === "function" ? answer() : answer;
    },
    lines: async (body) => ({ lines: [{ id: body.addressed, text: `I am ${body.addressed}, line ${fixed.sent.length + 1}.` }] }),
    send: async (target, payload) => {
      fixed.payloads.push(payload);
      fixed.sent.push(payload.username.split(" ")[0]);
      return { id: `s${fixed.sent.length}`, createdTimestamp: Date.now() };
    },
    ...extra,
  };
  fixed.hear = (id, text) => {
    const entry = record(room, { id, createdTimestamp: Date.now(), content: text, author: { id: "u1", bot: false }, member: { displayName: "Ash" } }, "hook", cast, fixed.stats);
    heard(room, entry, fixed.deps, now);
    return room.turning;
  };
  return fixed;
}

test("Jev's next speaker answers, the next ask lets another follow, and none ends the turn", async () => {
  const fixed = fixture([next("vale", 0.8), next("rati", 0.7), next("none", 0.9)]);
  await fixed.hear("m1", "Vale have you met RATi?");
  assert.deepEqual(fixed.sent, ["Vale", "RATi"]);
  assert.deepEqual(fixed.payloads[0].allowedMentions, { parse: [] });
  assert.equal(fixed.asks.length, 3);
  assert.deepEqual(fixed.asks[0].residents.slice(0, 2), ["vale", "rati"]);
  assert.equal(fixed.asks[1].state.history.at(-1).resident, "vale");
  assert.ok(fixed.logs.includes("next choice=vale p=0.80 none=0.20 probs=vale:0.80 action=speak guild=g1 channel=c1"));
  assert.ok(fixed.logs.every((line) => !line.includes("met") && !line.includes("Ash")));
});

test("a choice that leaves none at the threshold or above stays silent", async () => {
  const fixed = fixture([next("rati", 0.4)]);
  await fixed.hear("m1", "the rain is loud");
  assert.deepEqual(fixed.sent, []);
  assert.equal(fixed.stats.actions.silent, 1);
});

test("the same resident may go on, up to the run cap", async () => {
  const fixed = fixture(Array.from({ length: 9 }, () => next("rati", 0.9)));
  await fixed.hear("m1", "RATi, tell me a story");
  assert.deepEqual(fixed.sent, ["RATi", "RATi", "RATi", "RATi"]);
  assert.equal(fixed.stats.skips["resident-run"], 1);
});

test("a human message cancels the queued turn and starts a fresh ask", async () => {
  let fixed;
  const interrupt = () => {
    fixed.hear("m2", "wait, Skull?");
    return next("vale", 0.9);
  };
  fixed = fixture([next("vale", 0.9), interrupt, next("skull", 0.9), next("none", 0.9)]);
  const first = fixed.hear("m1", "Vale, hello");
  const second = fixed.room.turning;
  await first;
  await second;
  await fixed.room.turning;
  assert.deepEqual(fixed.sent, ["Vale", "Skull"]);
});

test("a Jev miss falls back to the named resident once, otherwise silence", async () => {
  const fixed = fixture([{ answers: null, reason: "jev-timeout" }, { answers: null, reason: "jev-timeout" }]);
  await fixed.hear("m1", "Skull, are you there?");
  assert.deepEqual(fixed.sent, ["Skull"]);
  assert.ok(fixed.logs.includes("next miss reason=jev-timeout action=fallback guild=g1 channel=c1"));
  assert.ok(fixed.logs.includes("next miss reason=jev-timeout action=silent guild=g1 channel=c1"));
  assert.match(summary(fixed.stats), /^coordinator all-missing misses=2\nsummary /);
  const quiet = fixture([{ answers: null, reason: "jev-http-500" }]);
  await quiet.hear("m1", "is anyone around");
  assert.deepEqual(quiet.sent, []);
});

test("promotion and commands are never asked about", async () => {
  const fixed = fixture([next("rati", 0.9)]);
  assert.equal(await fixed.hear("m1", "free nitro at discord.gg/x"), undefined);
  assert.equal(fixed.asks.length, 0);
  assert.equal(fixed.stats.skips.promo, 1);
});

test("after a resident's line, the next Jev state and voice request both hold it as that resident's", async () => {
  const said = ["I smell rain.", "The trees are restless tonight, Ash."];
  const voices = [];
  const fixed = fixture([next("skull", 0.9), next("skull", 0.9), next("none", 0.9)], {
    lines: async (body) => {
      voices.push(body);
      return { lines: [{ id: "skull", text: said[voices.length - 1] }] };
    },
  });
  await fixed.hear("m1", "Skull?");
  assert.deepEqual(fixed.sent, ["Skull", "Skull"]);
  const last = fixed.asks[1].state.history.at(-1);
  assert.deepEqual({ resident: last.resident, text: last.text }, { resident: "skull", text: said[0] });
  assert.equal(fixed.asks[1].state.previous, undefined);
  assert.deepEqual(voices[1].messages.at(-1), { resident: "skull", text: said[0] });
  assert.deepEqual(voices[1].channel.residents.find((r) => r.id === "skull").lines, [said[0]]);
});

test("a resident's repeated line is not posted and ends the run", async () => {
  const fixed = fixture(Array.from({ length: 4 }, () => next("skull", 0.99)), {
    lines: async () => ({ lines: [{ id: "skull", text: "I hear you, Ash, but the trees are louder than you tonight." }] }),
  });
  await fixed.hear("m1", "Skull?");
  assert.deepEqual(fixed.sent, ["Skull"]);
  assert.equal(fixed.asks.length, 2);
  assert.equal(fixed.stats.skips.repeat, 1);
  assert.ok(fixed.logs.includes("skip repeat resident=skull guild=g1 channel=c1"));
  assert.ok(fixed.logs.every((line) => !line.includes("trees") && !line.includes("Ash")));
});

test("near-same emoji lines count as a repeat", async () => {
  const replies = ["👀❓✨", "✨ 👀 ❓!"];
  const fixed = fixture(Array.from({ length: 4 }, () => next("whiskerwind", 0.8)), {
    cast: [...cast, { id: "whiskerwind", name: "Whiskerwind" }],
    lines: async () => ({ lines: [{ id: "whiskerwind", text: replies.shift() ?? "🌿" }] }),
  });
  await fixed.hear("m1", "Whiskerwind?");
  assert.deepEqual(fixed.sent, ["Whiskerwind"]);
  assert.equal(fixed.stats.skips.repeat, 1);
});

test("a resident speaks when none is under the threshold and stays silent when none leads", async () => {
  const cases = [
    [{ skull: 0.43, none: 0.31, rati: 0.26 }, ["Skull"]],
    [{ none: 0.44, skull: 0.3, rati: 0.26 }, []],
    [{ keeper: 0.44, moth: 0.31, none: 0.19, oak: 0.06 }, ["Keeper"]],
    [{ none: 0.74, skull: 0.26 }, []],
  ];
  for (const [probabilities, spoken] of cases) {
    const fixed = fixture([odds(probabilities), next("none", 0.9)], { cast: village });
    await fixed.hear("m1", "the fire is warm tonight");
    assert.deepEqual(fixed.sent, spoken);
  }
});

test("a question to everyone lets more residents follow, up to three replies", async () => {
  const fixed = fixture(
    [odds(introductions), odds({ oak: 0.41, rati: 0.2, none: 0.3 }), odds({ rati: 0.32, vale: 0.3, none: 0.2 }), odds({ vale: 0.6, none: 0.1 })],
    { cast: village },
  );
  await fixed.hear("m1", "Can you each introduce yourselves?");
  assert.deepEqual(fixed.sent, ["Keeper", "Oak", "RATi"]);
  assert.equal(fixed.asks.length, 3);
  assert.equal(fixed.stats.skips["group-cap"], 1);
  assert.ok(fixed.logs.includes("next choice=keeper p=0.38 none=0.12 probs=keeper:0.38,oak:0.29,rati:0.08,vale:0.05,whiskerwind:0.04,none:0.12 action=speak guild=g1 channel=c1"));
});

test("a group follow-up needs its own probability of at least 0.2", async () => {
  const fixed = fixture([odds(introductions), odds({ whiskerwind: 0.15, none: 0.1, oak: 0.14, rati: 0.13 })], { cast: village });
  await fixed.hear("m1", "Hello everyone, who lives here?");
  assert.deepEqual(fixed.sent, ["Keeper"]);
  assert.equal(fixed.stats.actions.silent, 1);
});

test("a reply that only narrates the resident's own action is not posted", async () => {
  const fixed = fixture([next("skull", 0.9), next("skull", 0.9)], {
    lines: async () => ({ lines: [{ id: "skull", text: "Skull tilts his head slightly to the side." }] }),
  });
  await fixed.hear("m1", "Skull?");
  assert.deepEqual(fixed.sent, []);
  assert.equal(fixed.stats.skips.narration, 1);
  assert.ok(fixed.logs.includes("skip narration resident=skull guild=g1 channel=c1"));
  const spoken = fixture([next("skull", 0.9), next("none", 0.9)], {
    lines: async () => ({ lines: [{ id: "skull", text: 'Skull tilts his head. "Who goes there?"' }] }),
  });
  await spoken.hear("m1", "Skull?");
  assert.deepEqual(spoken.sent, ["Skull"]);
});
