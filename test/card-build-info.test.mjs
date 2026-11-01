import { describe, expect, it } from "vitest";
import { buildInfo, showBuildInfo } from "../v2/card-game/build-info.mjs";

describe("card build info", () => {
  it("names the version, short commit, and shared rules", () => {
    expect(
      buildInfo({
        version: "1.2.104",
        commit: "94ff0b81fc97",
        card_game: { shared_rules_version: "57" },
      }),
    ).toEqual({
      text: "v1.2.104 · 94ff0b8 · rules 57",
      commitUrl: "https://github.com/cenetex/cosyworld/commit/94ff0b81fc97",
      sha: "94ff0b8",
    });
  });

  it("keeps whatever the server reports and drops the rest", () => {
    expect(buildInfo({ version: "1.2.104" })).toEqual({
      text: "v1.2.104",
      commitUrl: null,
      sha: null,
    });
    expect(buildInfo({ version: "1.2.104", commit: "<script>" }).text).toBe(
      "v1.2.104",
    );
    expect(buildInfo({})).toBeNull();
    expect(buildInfo(null)).toBeNull();
  });

  it("shows nothing when the server has no metadata", async () => {
    const offline = () => Promise.reject(new Error("offline"));
    await expect(
      showBuildInfo({ fetcher: offline, root: null }),
    ).resolves.toBeNull();
    const missing = async () => ({ ok: false });
    await expect(
      showBuildInfo({ fetcher: missing, root: null }),
    ).resolves.toBeNull();
  });
});
