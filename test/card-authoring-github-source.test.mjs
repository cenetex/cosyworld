import { afterEach, describe, expect, it, vi } from "vitest";
import { loadGitHubSource } from "../v2/card-game/authoring-github-source.mjs";

const commit = "a".repeat(40),
  treeId = "b".repeat(40);
const blob = (path = "v2/content/my world/card-world.json", size = 2) => ({
  path,
  size,
  type: "blob",
  mode: "100644",
});
function fixture({ entries = [blob()], truncated = false } = {}) {
  const replies = [
    { default_branch: "release/main" },
    { commit: { sha: commit, commit: { tree: { sha: treeId } } } },
    { truncated, tree: entries },
  ];
  const fetch = vi.fn(
    async () => new Response(JSON.stringify(replies.shift())),
  );
  return {
    replies,
    fetch,
    load: () =>
      loadGitHubSource("https://github.com/owner/world.git", { fetch }),
  };
}
afterEach(() => vi.useRealTimers());
describe("GitHub authoring source", () => {
  it("pins the branch and loads selected normal files lazily with safe request options", async () => {
    const f = fixture({
      entries: [
        blob(),
        { ...blob("link"), mode: "120000" },
        { type: "commit", path: "submodule" },
      ],
    });
    const result = await f.load();
    expect(result.origin).toEqual({
      kind: "github",
      repo: "owner/world",
      commit,
    });
    expect(result.files).toHaveLength(1);
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/owner/world",
      "https://api.github.com/repos/owner/world/branches/release%2Fmain",
      `https://api.github.com/repos/owner/world/git/trees/${treeId}?recursive=1`,
    ]);
    f.fetch.mockResolvedValueOnce(new Response("{}"));
    expect(
      new TextDecoder().decode(await result.files[0].file.arrayBuffer()),
    ).toBe("{}");
    expect(f.fetch.mock.lastCall[0]).toBe(
      `https://raw.githubusercontent.com/owner/world/${commit}/v2/content/my%20world/card-world.json`,
    );
    for (const [, options] of f.fetch.mock.calls)
      expect(options).toMatchObject({
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
  });
  it.each([
    "http://github.com/o/r",
    "https://github.com.evil/o/r",
    "https://user@github.com/o/r",
    "https://github.com/o/r?q=1",
    "https://github.com/o/r#main",
    "https://github.com/o/r/tree/main",
    "https://github.com/o/..",
    "https://github.com/o/%2e%2e",
    "https://github.com:443/o/r",
  ])("rejects unsafe repository URL %s", async (url) => {
    const fetch = vi.fn();
    await expect(loadGitHubSource(url, { fetch })).rejects.toThrow(
      "public repository URL",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects incomplete and excessive tree metadata", async () => {
    await expect(fixture({ truncated: true }).load()).rejects.toThrow(
      "complete file list",
    );
    await expect(
      fixture({ entries: Array(100_001).fill({}) }).load(),
    ).rejects.toThrow("complete file list");
    const f = fixture();
    f.fetch.mockResolvedValueOnce(
      new Response("{}", { headers: { "content-length": "1048577" } }),
    );
    await expect(f.load()).rejects.toThrow("size limit");
  });
  it.each([
    "../secret",
    "/root/file",
    "a//b",
    "a/../b",
    "a\\b",
    "a%20b",
    "a?b",
    "a#b",
    "x".repeat(513),
  ])("validates repository path %s", async (path) => {
    await expect(fixture({ entries: [blob(path)] }).load()).rejects.toThrow(
      "safe repository file paths",
    );
  });
  it("rejects duplicate paths, invalid sizes and a non-pinned head", async () => {
    await expect(fixture({ entries: [blob(), blob()] }).load()).rejects.toThrow(
      "distinct",
    );
    await expect(fixture({ entries: [blob("a", -1)] }).load()).rejects.toThrow(
      "file sizes",
    );
    const f = fixture();
    f.replies[1].commit.sha = "main";
    await expect(f.load()).rejects.toThrow("current commit");
  });
  it("bounds selected file bytes and checks the exact tree size", async () => {
    const f = fixture();
    const { files } = await f.load();
    for (const text of ["x", "long"]) {
      f.fetch.mockResolvedValueOnce(new Response(text));
      await expect(files[0].file.arrayBuffer()).rejects.toThrow(/size/u);
    }
    const large = fixture({
      entries: [blob("huge.bin", 16 * 1024 * 1024 + 1)],
    });
    const listed = await large.load();
    await expect(listed.files[0].file.arrayBuffer()).rejects.toThrow("16 MiB");
    expect(large.fetch).toHaveBeenCalledTimes(3);
  });
  it("rejects redirects and explains rate limits", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://elsewhere.test/" },
      }),
    );
    await expect(f.load()).rejects.toThrow("302");
    f.fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      }),
    );
    await expect(f.load()).rejects.toThrow("rate limit");
  });
  it("aborts a pending request at the timeout and honors caller cancellation", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        ),
    );
    const pending = expect(
      loadGitHubSource("https://github.com/o/r", { fetch }),
    ).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadGitHubSource("https://github.com/o/r", {
        fetch,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/iu);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
