import { DRAFT_LIMITS } from "./authoring-draft.mjs";

const need = (ok, text) => {
  if (!ok) throw new Error(text);
};
const sha = (value) =>
  typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
const pathOk = (path) =>
  typeof path === "string" &&
  path.length <= 512 &&
  !/[\\\u0000-\u001f\u007f:?#%]/u.test(path) &&
  path.split("/").every((part) => part && part !== "." && part !== "..");
const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

async function bytes(response, limit, expected) {
  const length = response.headers.get("content-length");
  need(
    length === null || (/^\d+$/u.test(length) && Number(length) <= limit),
    "Choose a GitHub file within its size limit.",
  );
  const reader = response.body?.getReader();
  need(reader, "Read the GitHub file again.");
  const output = expected === undefined ? null : new Uint8Array(expected);
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      need(
        size + value.byteLength <= (expected ?? limit),
        "The GitHub response exceeds its recorded size limit.",
      );
      if (output) output.set(value, size);
      else chunks.push(value);
      size += value.byteLength;
    }
    need(
      expected === undefined || size === expected,
      "The GitHub file size changed. Load its source again.",
    );
    if (output) return output;
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// GitHub's repository, branch and recursive-tree endpoints pin this file list.
// Selected files alone read raw bytes; the importer owns the total asset budget.
export async function loadGitHubSource(
  repoUrl,
  { signal, fetch: request = globalThis.fetch } = {},
) {
  const match =
    typeof repoUrl === "string" &&
    /^https:\/\/github\.com\/([A-Za-z\d][A-Za-z\d-]{0,38})\/([A-Za-z\d_.-]{1,104})\/?$/u.exec(
      repoUrl,
    );
  const repo = match?.[2].replace(/\.git$/u, "");
  need(
    match && repo.length <= 100 && !["", ".", ".."].includes(repo),
    "Enter a public repository URL such as https://github.com/owner/repo.",
  );
  const repository = `${match[1]}/${repo}`;
  const api = `https://api.github.com/repos/${repository}`;
  async function read(url, limit, expected) {
    signal?.throwIfAborted();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 15_000);
    const combined = signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal;
    let response;
    try {
      response = await request(url, {
        signal: combined,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: url.startsWith(api)
          ? {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            }
          : {},
      });
      need(
        !response.redirected && (!response.url || response.url === url),
        "Use the repository's current GitHub URL.",
      );
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get("x-ratelimit-remaining") === "0" ||
            response.headers.has("retry-after")))
      )
        throw new Error("GitHub's rate limit was reached. Try again later.");
      need(
        response.status === 200,
        `GitHub returned ${response.status}. Choose a public repository or try again.`,
      );
      return await bytes(response, limit, expected);
    } catch (error) {
      signal?.throwIfAborted();
      if (timeout.signal.aborted)
        throw new Error("GitHub took too long. Try again.");
      throw error;
    } finally {
      clearTimeout(timer);
      await response?.body?.cancel().catch(() => {});
    }
  }
  const json = async (url, limit = 1024 * 1024) =>
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(await read(url, limit)),
    );
  const metadata = await json(api);
  const branch = metadata.default_branch;
  need(
    typeof branch === "string" &&
      branch.length > 0 &&
      branch.length <= 255 &&
      !/[\u0000-\u001f\u007f]/u.test(branch),
    "Choose a repository with a default branch.",
  );
  const head = await json(`${api}/branches/${encodeURIComponent(branch)}`);
  const commit = head.commit?.sha,
    treeId = head.commit?.commit?.tree?.sha;
  need(
    sha(commit) && sha(treeId),
    "Read the repository's current commit again.",
  );
  const tree = await json(
    `${api}/git/trees/${treeId}?recursive=1`,
    8 * 1024 * 1024,
  );
  need(
    tree.truncated === false &&
      Array.isArray(tree.tree) &&
      tree.tree.length <= 100_000,
    "Choose a smaller repository with a complete file list.",
  );
  const paths = new Set(),
    files = [];
  for (const entry of tree.tree) {
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))
      continue;
    const { path, size } = entry;
    need(
      pathOk(path) && !paths.has(path),
      "Choose distinct safe repository file paths.",
    );
    need(
      Number.isSafeInteger(size) && size >= 0,
      "Read the repository's file sizes again.",
    );
    paths.add(path);
    files.push({
      path,
      file: {
        size,
        async arrayBuffer() {
          need(
            size <= DRAFT_LIMITS.assetBytes,
            "Choose a GitHub file within 16 MiB.",
          );
          return (
            await read(
              `https://raw.githubusercontent.com/${repository}/${commit}/${encodePath(path)}`,
              DRAFT_LIMITS.assetBytes,
              size,
            )
          ).buffer;
        },
      },
    });
  }
  return { files, origin: { kind: "github", repo: repository, commit } };
}
