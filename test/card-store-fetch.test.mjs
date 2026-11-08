import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { scanFiles } from "../v2/scripts/card-store.mjs";
import {
  fetchGitSource,
  isolatedGit,
  objectInventory,
  sourceUrl,
} from "../v2/scripts/card-store-fetch.mjs";
vi.mock("node:child_process", async (original) => {
  const module = await original();
  return { ...module, execFileSync: vi.fn(module.execFileSync) };
});
const actualExec = (await vi.importActual("node:child_process")).execFileSync;
const source = { repo: "example/cosyworld-pack", commit: "1".repeat(40) };
const roots = [];
const temp = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosy-fetch-test-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.mocked(execFileSync).mockImplementation(actualExec);
  roots
    .splice(0)
    .forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});
it("derives one HTTPS endpoint from a scalar source pin", () => {
  expect(sourceUrl(source)).toBe(
    "https://github.com/example/cosyworld-pack.git",
  );
});
it.each([
  { repo: "../outside" },
  { repo: "example/repo?token=private" },
  { repo: "example/repo/extra" },
  { repo: ["example/repo"] },
  { commit: [source.commit] },
  { commit: "main" },
  { commit: "0".repeat(40) },
])("rejects unsafe source input %j before starting Git", (patch) => {
  expect(() => fetchGitSource({ ...source, ...patch })).toThrow();
  expect(execFileSync).not.toHaveBeenCalled();
});
it("ignores inherited Git config, object paths and credentials", () => {
  const root = temp();
  const ambient = path.join(root, "ambient-home");
  fs.mkdirSync(ambient);
  fs.writeFileSync(
    path.join(ambient, ".netrc"),
    "machine github.com login ambient-user password unused\n",
  );
  vi.stubEnv("HOME", ambient);
  vi.stubEnv("USERPROFILE", ambient);
  vi.stubEnv("NETRC", path.join(ambient, ".netrc"));
  const poison = path.join(root, "poison-config");
  fs.writeFileSync(
    poison,
    "[user]\n name = poison\n[credential]\n helper = poison\n",
  );
  for (const key of [
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
    "GIT_DIR",
    "GIT_OBJECT_DIRECTORY",
  ])
    vi.stubEnv(key, poison);
  vi.stubEnv("GIT_CONFIG_COUNT", "1");
  vi.stubEnv("GIT_CONFIG_KEY_0", "user.name");
  vi.stubEnv("GIT_CONFIG_VALUE_0", "poison");
  const repository = path.join(root, "private");
  fs.mkdirSync(repository);
  const git = isolatedGit(repository);
  git(["init", "--bare", "--template=", "--object-format=sha1", "."]);
  const config = git(["config", "--list"]).toString();
  const childEnv = vi.mocked(execFileSync).mock.calls.at(-1)[2].env;
  expect(childEnv.HOME).toBe(path.join(repository, "private-home"));
  expect(childEnv.USERPROFILE).toBe(childEnv.HOME);
  expect(childEnv.NETRC).toBeUndefined();
  expect(fs.readdirSync(childEnv.HOME)).toEqual([]);
  expect(process.env.HOME).toBe(ambient);
  expect(process.env.USERPROFILE).toBe(ambient);
  expect(config).not.toContain("poison");
  expect(config).toContain("credential.helper=\n");
  expect(config).toContain("http.followredirects=false");
  expect(fs.readFileSync(poison, "utf8")).toContain("name = poison");
});
it.each([
  "oversize-blob",
  "oversize-tree",
  "unexpected",
  "duplicate",
  "noninteger",
])("rejects %s object inventory", (change) => {
  let lines = `${source.commit} blob 5\n`;
  if (change === "oversize-blob")
    lines = `${source.commit} blob ${16 * 1024 * 1024 + 1}\n`;
  if (change === "oversize-tree")
    lines = `${source.commit} tree ${256 * 1024 + 1}\n`;
  if (change === "unexpected") lines = `${"2".repeat(40)} blob 5\n`;
  if (change === "duplicate") lines += lines;
  if (change === "noninteger") lines = `${source.commit} blob 1.5\n`;
  expect(() =>
    objectInventory(Buffer.from(lines), new Set([source.commit])),
  ).toThrow();
});
it("removes only its private directory after Git fails", () => {
  const input = path.join(temp(), "private-input");
  fs.writeFileSync(input, "untouched");
  let repository;
  vi.mocked(execFileSync).mockImplementationOnce((_git, _args, options) => {
    repository = options.cwd;
    fs.writeFileSync(path.join(repository, "partial"), "partial download");
    throw new Error("simulated Git failure");
  });
  expect(() => fetchGitSource(source)).toThrow(/simulated Git failure/);
  expect(fs.existsSync(repository)).toBe(false);
  expect(fs.readFileSync(input, "utf8")).toBe("untouched");
});
it("returns the exact bounded fixture snapshot without checking out files", () => {
  const fixture = fileURLToPath(
    new URL("./fixtures/card-store/", import.meta.url),
  );
  const proof = JSON.parse(
    fs.readFileSync(path.join(fixture, "worldpacks/proofs/sample.json")),
  );
  const objects = new Map([
    [proof.source.commit, ["commit", Buffer.from(proof.commit, "base64")]],
  ]);
  for (const [oid, encoded] of Object.entries(proof.trees))
    objects.set(oid, ["tree", Buffer.from(encoded, "base64")]);
  const payload = path.join(fixture, "worldpacks/sample");
  const files = scanFiles(payload);
  for (const file of files)
    objects.set(file.gitBlob, [
      "blob",
      fs.readFileSync(path.join(payload, file.path)),
    ]);
  const fetched = new Set();
  let repository;
  vi.mocked(execFileSync).mockImplementation((_git, args, options) => {
    repository = options.cwd;
    const start = args.findIndex((arg) =>
      ["init", "fetch", "cat-file", "count-objects"].includes(arg),
    );
    const [command, ...rest] = args.slice(start);
    if (command === "init") return Buffer.alloc(0);
    if (command === "fetch") {
      const remote = rest.indexOf(sourceUrl(proof.source));
      expect(remote).toBeGreaterThan(0);
      rest.slice(remote + 1).forEach((oid) => fetched.add(oid));
      return Buffer.alloc(0);
    }
    if (command === "count-objects")
      return Buffer.from("size: 0\nsize-pack: 1\nsize-garbage: 0\n");
    expect(command).toBe("cat-file");
    if (rest[0] === "--batch-all-objects")
      return Buffer.from(
        [...fetched]
          .map(
            (oid) =>
              `${oid} ${objects.get(oid)[0]} ${objects.get(oid)[1].length}\n`,
          )
          .join(""),
      );
    expect(objects.get(rest[1])[0]).toBe(rest[0]);
    return objects.get(rest[1])[1];
  });
  const snapshot = fetchGitSource(proof.source);
  expect(snapshot.proof).toEqual(proof);
  expect(snapshot.files.map((file) => file.path)).toEqual(
    files.map((file) => file.path),
  );
  for (const file of snapshot.files)
    expect(file.bytes).toEqual(fs.readFileSync(path.join(payload, file.path)));
  expect(fs.existsSync(repository)).toBe(false);
});
