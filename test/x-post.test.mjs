import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authorization, baseString, day, due, problems } from "../scripts/x-post.mjs";

const keys = {
  X_API_KEY: "key",
  X_API_SECRET: "secret",
  X_ACCESS_TOKEN: "token",
  X_ACCESS_TOKEN_SECRET: "token secret",
};

describe("X post signing", () => {
  it("sorts and encodes the base string", () => {
    expect(baseString("post", "https://api.x.com/2/tweets", { b: "two words", a: "1!" })).toBe(
      "POST&https%3A%2F%2Fapi.x.com%2F2%2Ftweets&a%3D1%2521%26b%3Dtwo%2520words",
    );
  });

  it("signs the same request the same way and a changed one differently", () => {
    const fixed = { nonce: "n", timestamp: 1 };
    const first = authorization("GET", "https://api.x.com/2/users/me", keys, fixed);
    expect(authorization("GET", "https://api.x.com/2/users/me", keys, fixed)).toBe(first);
    expect(first).toMatch(/^OAuth oauth_consumer_key="key", oauth_nonce="n", oauth_signature="[^"]+", /);
    expect(authorization("GET", "https://api.x.com/2/media/upload?command=STATUS&media_id=1", keys, fixed)).not.toBe(first);
    expect(authorization("GET", "https://api.x.com/2/users/me", { ...keys, X_API_SECRET: "other" }, fixed)).not.toBe(first);
  });
});

describe("X post schedule", () => {
  const queue = {
    posts: [
      { id: "a", day: 1, text: "one", approved: true },
      { id: "b", day: 1, text: "two", approved: false },
      { id: "c", day: 2, text: "three", approved: true },
    ],
  };

  it("counts days from the start date", () => {
    expect(day("2026-12-01", "2026-12-01")).toBe(1);
    expect(day("2026-12-01", "2026-12-14")).toBe(14);
    expect(day("", "2026-12-01")).toBe(null);
    expect(day("soon", "2026-12-01")).toBe(null);
  });

  it("posts only approved posts for the day, and nothing without a start date", () => {
    expect(due(queue, "2026-12-01", "2026-12-01").map((post) => post.id)).toEqual(["a"]);
    expect(due(queue, "2026-12-01", "2026-12-02").map((post) => post.id)).toEqual(["c"]);
    expect(due(queue, "2026-12-01", "2026-11-30")).toEqual([]);
    expect(due(queue, undefined, "2026-12-01")).toEqual([]);
  });

  it("flags a bad queue", () => {
    expect(problems(queue)).toEqual([]);
    const bad = { posts: [{ id: "a", day: 0, text: "x".repeat(281), approved: "yes", portrait: "p.png" }, { id: "a", day: 1, text: "ok", approved: true }] };
    expect(problems(bad)).toHaveLength(5);
    expect(problems({ posts: [{ id: "v", day: 1, text: "ok", approved: true, video: "../x.mp4" }] })).toHaveLength(1);
  });

  it("ships a valid queue of one post a day", () => {
    const shipped = JSON.parse(readFileSync(new URL("../v2/social/x-posts.json", import.meta.url), "utf8"));
    expect(problems(shipped)).toEqual([]);
    expect(shipped.posts.map((post) => post.day)).toEqual(shipped.posts.map((_, index) => index + 1));
  });
});
