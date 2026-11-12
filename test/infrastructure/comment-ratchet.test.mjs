import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  check,
  countComments,
  evaluate,
  isCounted,
} from "../../scripts/check-comment-ratchet.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function repo(files) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "comment-ratchet-"));
  roots.push(cwd);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.test",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.test",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    }).trim();
  const commit = (changes, message) => {
    for (const [file, text] of Object.entries(changes)) {
      mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      if (text === null) rmSync(path.join(cwd, file));
      else writeFileSync(path.join(cwd, file), text);
    }
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  commit(files, "base");
  return { cwd, git, commit };
}

const SLASH = ["/", "/"].join("");
const OPEN = ["/", "*"].join("");
const CLOSE = ["*", "/"].join("");

describe("comment ratchet", () => {
  it("counts whole comment lines by file kind and skips directives", () => {
    const js = [
      "#!/usr/bin/env node",
      `${SLASH} one`,
      `const a = 1; ${SLASH} trailing`,
      `${OPEN} two`,
      " three",
      ` four ${CLOSE}`,
      `${OPEN} five ${CLOSE}`,
      `${SLASH} eslint-disable-next-line no-console`,
      `${SLASH} Copyright someone`,
      `const url = "http:${SLASH}example.test";`,
    ].join("\n");
    expect(countComments(js, "slash")).toBe(5);
    expect(countComments(`a {}\n${OPEN} x ${CLOSE}\n* { b: c }\n`, "css")).toBe(
      1,
    );
    expect(countComments("<p>\n<!-- a\nb -->\n</p>\n", "html")).toBe(2);
    expect(countComments("#!/bin/sh\n# a\necho 1 # b\n  # c\n", "hash")).toBe(
      2,
    );
  });

  it("chooses source files and leaves out generated ones", () => {
    const excluded = ["gen/engine-v*.js", "**/package-lock.json"];
    expect(isCounted("a/b.mjs", excluded)).toBe(true);
    expect(isCounted("a/b.rs", excluded)).toBe(true);
    expect(isCounted("gen/engine-v12.js", excluded)).toBe(false);
    expect(isCounted("a/node_modules/x.js", excluded)).toBe(false);
    expect(isCounted("a/b.md", excluded)).toBe(false);
    expect(isCounted("a/b.json", excluded)).toBe(false);
  });

  it("requires a strictly lower count, or zero to stay zero", () => {
    expect(evaluate(10, 9).ok).toBe(true);
    expect(evaluate(10, 10).ok).toBe(false);
    expect(evaluate(10, 11).ok).toBe(false);
    expect(evaluate(0, 0).ok).toBe(true);
    expect(evaluate(0, 1).ok).toBe(false);
    expect(evaluate(10, 7).lines[0]).toBe(
      "[comment-ratchet] base 10, head 7, difference -3",
    );
  });

  it("compares a branch with its merge base in a real repository", () => {
    const { cwd, git, commit } = repo({
      "src/a.mjs": `${SLASH} a\n${SLASH} b\nexport const a = 1;\n`,
      "src/b.rs": `${SLASH}${SLASH} doc\nfn b() {}\n`,
      "gen/engine-v1.js": `${SLASH} generated\n`,
      "notes.txt": `${SLASH} not source\n`,
    });
    const excluded = ["gen/engine-v*.js"];
    git("checkout", "-q", "-b", "work");
    commit({ "src/a.mjs": `${SLASH} a\nexport const a = 1;\n` }, "fewer");
    const fewer = check({ cwd, base: "main", head: "HEAD", excluded });
    expect(fewer).toMatchObject({ baseCount: 3, headCount: 2, ok: true });

    commit(
      { "gen/engine-v1.js": `${SLASH} g\n${SLASH} g\n${SLASH} g\n` },
      "generated",
    );
    expect(check({ cwd, base: "main", head: "HEAD", excluded }).headCount).toBe(
      2,
    );

    commit({ "src/c.css": `${OPEN} c ${CLOSE}\na {}\n` }, "same");
    const same = check({ cwd, base: "main", head: "HEAD", excluded });
    expect(same).toMatchObject({ baseCount: 3, headCount: 3, ok: false });

    git("checkout", "-q", "main");
    commit(
      { "src/d.mjs": `${SLASH} d\n${SLASH} d\n${SLASH} d\n` },
      "main moves",
    );
    const moved = check({ cwd, base: "main", head: "work", excluded });
    expect(moved).toMatchObject({ baseCount: 3, headCount: 3, ok: false });
  });

  it("holds a repository with no comments at zero", () => {
    const { cwd, git, commit } = repo({ "a.mjs": "export const a = 1;\n" });
    git("checkout", "-q", "-b", "work");
    commit({ "b.mjs": "export const b = 2;\n" }, "clean");
    expect(check({ cwd, base: "main", head: "HEAD", excluded: [] }).ok).toBe(
      true,
    );
    commit({ "b.mjs": `${SLASH} b\nexport const b = 2;\n` }, "comment");
    expect(
      check({ cwd, base: "main", head: "HEAD", excluded: [] }),
    ).toMatchObject({
      baseCount: 0,
      headCount: 1,
      ok: false,
    });
  });
});
