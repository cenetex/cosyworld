import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(scriptDir, "..");
const defaultPackPath = path.join(v2Root, "content", "hoppycat-archive", "pack.json");
const defaultOutputPath = path.join(v2Root, "worlds", "hoppycat", "github-index.json");
const expectedOwner = "HoppyCat";

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeLicense(repo) {
  const value = repo.license_spdx ?? repo.license?.spdx_id;
  return typeof value === "string" && value.trim() ? value : "NOASSERTION";
}

function normalizeRepository(repo) {
  const repositoryId = Number(repo.repository_id ?? repo.id);
  const fullName = String(repo.current_full_name ?? repo.full_name ?? "");
  const name = String(repo.name ?? fullName.split("/").at(-1) ?? "");
  const url = String(repo.url ?? repo.html_url ?? `https://github.com/${fullName}`);
  return {
    repository_id: repositoryId,
    name,
    current_full_name: fullName,
    url,
    description: typeof repo.description === "string" ? repo.description : null,
    default_branch: String(repo.default_branch ?? "main"),
    head_sha: typeof repo.head_sha === "string" ? repo.head_sha : null,
    head_committed_at: typeof repo.head_committed_at === "string"
      ? repo.head_committed_at
      : null,
    pushed_at: typeof repo.pushed_at === "string" ? repo.pushed_at : null,
    archived: repo.archived === true,
    visibility: String(repo.visibility ?? "public"),
    license_spdx: normalizeLicense(repo),
  };
}

export function sourceMappings(pack) {
  const extension = pack.extensions?.["x-hoppycat-github-sources"];
  assert(extension?.schema_version === 1, "HoppyCat pack source extension must use schema version 1");
  assert(extension.owner === expectedOwner, `HoppyCat pack source owner must be ${expectedOwner}`);
  assert(Array.isArray(extension.sources), "HoppyCat pack source extension must declare sources");
  const mappings = new Map();
  for (const source of extension.sources) {
    assert(Number.isSafeInteger(source.repository_id), "source repository_id must be a safe integer");
    assert(!mappings.has(source.repository_id), `duplicate source repository id ${source.repository_id}`);
    assert(
      typeof source.repository === "string" && source.repository.startsWith(`${expectedOwner}/`),
      `source ${source.repository_id} has an invalid repository name`,
    );
    assert(Number.isSafeInteger(source.location_id), `source ${source.repository} has no location id`);
    assert(typeof source.role === "string" && source.role.trim(), `source ${source.repository} has no role`);
    assert(
      typeof source.reuse_policy === "string" && source.reuse_policy.trim(),
      `source ${source.repository} has no reuse policy`,
    );
    mappings.set(source.repository_id, source);
  }
  return mappings;
}

export function buildGithubIndex(repositories, mappings) {
  const liveById = new Map();
  for (const source of repositories.map(normalizeRepository)) {
    assert(Number.isSafeInteger(source.repository_id), "GitHub repository id must be a safe integer");
    assert(!liveById.has(source.repository_id), `duplicate GitHub repository id ${source.repository_id}`);
    if (source.visibility !== "public") continue;
    liveById.set(source.repository_id, source);
  }

  const rows = [];
  for (const source of liveById.values()) {
    const mapping = mappings.get(source.repository_id);
    rows.push({
      ...source,
      location_id: mapping?.location_id ?? null,
      source_role: mapping?.role ?? "unmapped public repository",
      reuse_policy: mapping?.reuse_policy ?? "link_only_review_required",
      curation_state: mapping ? "mapped" : "review_required",
    });
  }
  for (const [repositoryId, mapping] of mappings) {
    if (liveById.has(repositoryId)) continue;
    rows.push({
      repository_id: repositoryId,
      name: mapping.repository.split("/").at(-1),
      current_full_name: mapping.repository,
      url: `https://github.com/${mapping.repository}`,
      description: null,
      default_branch: null,
      head_sha: null,
      head_committed_at: null,
      pushed_at: null,
      archived: false,
      visibility: "unknown",
      license_spdx: "NOASSERTION",
      location_id: mapping.location_id,
      source_role: mapping.role,
      reuse_policy: mapping.reuse_policy,
      curation_state: "missing_at_source",
    });
  }
  rows.sort((left, right) =>
    left.current_full_name.toLowerCase().localeCompare(right.current_full_name.toLowerCase())
      || left.repository_id - right.repository_id);

  const observedThrough = rows
    .flatMap((repo) => [repo.head_committed_at, repo.pushed_at])
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const snapshotId = sha256(json(rows));
  return {
    schema_version: 1,
    owner: expectedOwner,
    authority: "non_authoritative_public_github_metadata",
    observed_through: observedThrough,
    snapshot_id: snapshotId,
    repositories: rows,
  };
}

export function validateGithubIndex(index, mappings) {
  assert(index?.schema_version === 1, "GitHub index must use schema version 1");
  assert(index.owner === expectedOwner, `GitHub index owner must be ${expectedOwner}`);
  assert(
    index.authority === "non_authoritative_public_github_metadata",
    "GitHub index must remain non-authoritative metadata",
  );
  assert(Array.isArray(index.repositories), "GitHub index repositories must be an array");
  const rebuilt = buildGithubIndex(index.repositories, mappings);
  assert(index.snapshot_id === rebuilt.snapshot_id, "GitHub index snapshot id is stale");
  assert(index.observed_through === rebuilt.observed_through, "GitHub index observed_through is stale");
  assert(json(index.repositories) === json(rebuilt.repositories), "GitHub index repositories are not canonical");
  return index;
}

async function githubJson(url, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "cosyworld-hoppycat-source-index",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${url}`);
  }
  return response.json();
}

export async function fetchPublicRepositories(token = process.env.GITHUB_TOKEN) {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubJson(
      `https://api.github.com/users/${expectedOwner}/repos?type=owner&sort=full_name&per_page=100&page=${page}`,
      token,
    );
    assert(Array.isArray(batch), "GitHub repositories response must be an array");
    repositories.push(...batch.filter((repo) => repo.visibility === "public" && repo.private !== true));
    if (batch.length < 100) break;
  }

  return Promise.all(repositories.map(async (repo) => {
    const branch = await githubJson(
      `https://api.github.com/repos/${expectedOwner}/${encodeURIComponent(repo.name)}/branches/${encodeURIComponent(repo.default_branch)}`,
      token,
    );
    return {
      ...repo,
      head_sha: branch.commit?.sha ?? null,
      head_committed_at: branch.commit?.commit?.committer?.date ?? null,
    };
  }));
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  assert(args[index + 1] && !args[index + 1].startsWith("--"), `${name} requires a path`);
  return path.resolve(args[index + 1]);
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const check = args.includes("--check");
  const validate = args.includes("--validate");
  assert(Number(write) + Number(check) + Number(validate) === 1, "choose exactly one of --write, --check, or --validate");
  const packPath = optionValue(args, "--pack") ?? defaultPackPath;
  const outputPath = optionValue(args, "--output") ?? defaultOutputPath;
  const inputPath = optionValue(args, "--input");
  const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
  const mappings = sourceMappings(pack);

  if (validate) {
    validateGithubIndex(JSON.parse(fs.readFileSync(outputPath, "utf8")), mappings);
    console.log(`HoppyCat GitHub index valid: ${outputPath}`);
    return;
  }

  const input = inputPath
    ? JSON.parse(fs.readFileSync(inputPath, "utf8"))
    : await fetchPublicRepositories();
  const repositories = Array.isArray(input) ? input : input.repositories;
  assert(Array.isArray(repositories), "source index input must be an array or contain repositories");
  const next = buildGithubIndex(repositories, mappings);
  const contents = json(next);
  if (check) {
    assert(fs.existsSync(outputPath), `missing HoppyCat GitHub index ${outputPath}`);
    assert(fs.readFileSync(outputPath, "utf8") === contents, "HoppyCat GitHub index is stale; run with --write");
    console.log(`HoppyCat GitHub index current: ${next.snapshot_id}`);
    return;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, contents);
  console.log(`HoppyCat GitHub index updated: ${next.snapshot_id}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
