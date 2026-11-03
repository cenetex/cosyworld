import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COUNTERS,
  ENDPOINT,
  METRICS_KEY,
  createMetrics,
  lineCounter,
  playCounter,
} from "../v2/card-game/metrics.mjs";

const DAY = 20_394;

function setup({ stored = null, gpc, desktop = false } = {}) {
  const store = new Map(stored ? [[METRICS_KEY, stored]] : []);
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  const sent = [];
  const nav = {
    globalPrivacyControl: gpc,
    sendBeacon: (url, blob) => sent.push({ url, blob }) > 0,
  };
  const metrics = createMetrics({
    storage,
    nav,
    desktop,
    now: () => DAY * 86_400_000 + 5000,
  });
  return { metrics, sent, store };
}

describe("anonymous play counts", () => {
  it("mirrors the server's counter list", () => {
    const rust = readFileSync(
      new URL("../v2/orchestrator-rust/src/play_metrics.rs", import.meta.url),
      "utf8",
    );
    const list = rust.match(/COUNTERS: &str = "([^"]*)"/)[1];
    expect([...COUNTERS]).toEqual(list.replace(/\\/g, " ").trim().split(/\s+/));
  });

  it("counts in memory and flushes one beacon of daily totals only", async () => {
    const { metrics, sent } = setup();
    metrics.count("play.talk");
    metrics.count("play.talk");
    metrics.count("travel");
    metrics.count("Vale said hello");
    for (let i = 0; i < 1500; i += 1) metrics.count("line.skip");
    expect(metrics.flush()).not.toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(ENDPOINT);
    const payload = JSON.parse(await sent[0].blob.text());
    // The whole payload: a day number and allowlisted counts. No ids, no text.
    expect(Object.keys(payload).sort()).toEqual(["counters", "day"]);
    expect(payload).toEqual({
      day: DAY,
      counters: { "play.talk": 2, travel: 1, "line.skip": 1000 },
    });
    expect(metrics.flush()).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("sends nothing when the player opts out or the browser sends GPC", () => {
    const cases = [
      setup({ stored: "off" }),
      setup({ gpc: true }),
      setup({ gpc: true, stored: "on" }),
      setup({ desktop: true }),
    ];
    for (const { metrics, sent } of cases) {
      metrics.count("play.talk");
      expect(metrics.enabled()).toBe(false);
      expect(metrics.flush()).toBeNull();
      expect(sent).toEqual([]);
    }
  });

  it("turns off from Settings, dropping what was counted, and the desktop app opts in", () => {
    const { metrics, sent, store } = setup();
    metrics.count("defeat");
    metrics.setEnabled(false);
    expect(store.get(METRICS_KEY)).toBe("off");
    metrics.count("defeat");
    metrics.flush();
    expect(sent).toEqual([]);
    const desktop = setup({ desktop: true });
    desktop.metrics.setEnabled(true);
    desktop.metrics.count("session.start");
    desktop.metrics.flush();
    expect(desktop.sent).toHaveLength(1);
  });

  it("names plays by verb and Thinking waits by bucket", () => {
    expect(playCounter({ kind: "talk" })).toBe("play.talk");
    expect(playCounter({ kind: "wait", sleep: true })).toBe("play.sleep");
    expect(playCounter({ kind: "wait" })).toBe("play.wait");
    expect(playCounter({ kind: "focus", quest: 1 })).toBe("quest.accept");
    expect(playCounter({ kind: "drop" })).toBe("quest.abandon");
    expect(playCounter({ kind: "drop", item: "lamp" })).toBe("play.drop");
    expect(playCounter({ kind: "sing" })).toBe("play.other");
    expect([500, 3000, 7000, 15_000, 60_000].map(lineCounter)).toEqual([
      "voice.line.lt2s",
      "voice.line.2to5s",
      "voice.line.5to10s",
      "voice.line.10to20s",
      "voice.line.gt20s",
    ]);
  });
});
