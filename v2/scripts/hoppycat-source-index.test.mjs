import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGithubIndex,
  sourceMappings,
  validateGithubIndex,
} from "./hoppycat-source-index.mjs";

const pack = {
  extensions: {
    "x-hoppycat-github-sources": {
      schema_version: 1,
      owner: "HoppyCat",
      sources: [
        {
          repository_id: 10,
          repository: "HoppyCat/mapped",
          location_id: 770000,
          role: "mapped source",
          reuse_policy: "link_only",
        },
        {
          repository_id: 20,
          repository: "HoppyCat/missing",
          location_id: 770001,
          role: "missing source",
          reuse_policy: "link_only",
        },
      ],
    },
  },
};

test("GitHub source index maps known repos, flags new repos, and retains tombstones", () => {
  const mappings = sourceMappings(pack);
  const index = buildGithubIndex([
    {
      id: 10,
      name: "renamed",
      full_name: "HoppyCat/renamed",
      html_url: "https://github.com/HoppyCat/renamed",
      description: "A mapped repository after a rename.",
      default_branch: "main",
      head_sha: "a".repeat(40),
      head_committed_at: "2026-08-11T00:00:00Z",
      pushed_at: "2026-08-11T00:00:00Z",
      visibility: "public",
      license: { spdx_id: "MIT" },
    },
    {
      id: 30,
      name: "new-growth",
      full_name: "HoppyCat/new-growth",
      html_url: "https://github.com/HoppyCat/new-growth",
      default_branch: "main",
      head_sha: "b".repeat(40),
      head_committed_at: "2026-08-12T00:00:00Z",
      pushed_at: "2026-08-12T00:00:00Z",
      visibility: "public",
    },
  ], mappings);

  assert.equal(index.repositories.length, 3);
  assert.equal(index.repositories.find((repo) => repo.repository_id === 10).curation_state, "mapped");
  assert.equal(index.repositories.find((repo) => repo.repository_id === 10).current_full_name, "HoppyCat/renamed");
  assert.equal(index.repositories.find((repo) => repo.repository_id === 20).curation_state, "missing_at_source");
  assert.equal(index.repositories.find((repo) => repo.repository_id === 30).curation_state, "review_required");
  assert.equal(index.repositories.find((repo) => repo.repository_id === 30).location_id, null);
  validateGithubIndex(index, mappings);
});

test("private repository metadata never enters the public source index", () => {
  const mappings = sourceMappings(pack);
  const index = buildGithubIndex([
    {
      id: 99,
      name: "private-source",
      full_name: "HoppyCat/private-source",
      visibility: "private",
    },
  ], mappings);
  assert.equal(index.repositories.some((repo) => repo.repository_id === 99), false);
});
