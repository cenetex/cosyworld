// Name the running build. Versions bump only at release, so the commit tells
// one .dev deploy from the next.
const REPO_COMMIT_URL = "https://github.com/cenetex/cosyworld/commit/";

export function buildInfo(meta) {
  if (!meta || typeof meta !== "object") return null;
  const version = typeof meta.version === "string" ? meta.version.trim() : "";
  const sha =
    typeof meta.commit === "string" && /^[0-9a-f]{7,40}$/i.test(meta.commit)
      ? meta.commit.toLowerCase()
      : "";
  const rules = meta.card_game?.shared_rules_version;
  const parts = [];
  if (version) parts.push(version.startsWith("v") ? version : `v${version}`);
  if (sha) parts.push(sha.slice(0, 7));
  if (rules != null && String(rules).trim())
    parts.push(`rules ${String(rules).trim()}`);
  if (!parts.length) return null;
  return {
    text: parts.join(" · "),
    commitUrl: sha ? REPO_COMMIT_URL + sha : null,
    sha: sha ? sha.slice(0, 7) : null,
  };
}

export async function showBuildInfo({
  fetcher = globalThis.fetch,
  root = globalThis.document,
} = {}) {
  let info = null;
  try {
    const response = await fetcher("/meta", {
      headers: { Accept: "application/json" },
    });
    if (response.ok) info = buildInfo(await response.json());
  } catch {
    // A static server has no /meta; the game plays without a build line.
  }
  if (!info || !root) return info;
  const dialog = root.getElementById("menu-dialog");
  if (dialog) {
    const footer = root.createElement("p");
    footer.id = "build-info";
    footer.className = "build-info";
    const [before, after] = info.sha ? info.text.split(info.sha) : [info.text];
    footer.append(before);
    if (info.sha) {
      const link = root.createElement("a");
      link.href = info.commitUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = info.sha;
      footer.append(link, after);
    }
    dialog.append(footer);
    // Shared play adds buttons later; keep the build line last.
    dialog.addEventListener("toggle", () => dialog.append(footer));
  }
  const brand = root.querySelector(".brand");
  if (brand) brand.title = `Build ${info.text}`;
  const wordmark = root.getElementById("scene-video-button");
  if (wordmark)
    wordmark.title = [wordmark.title, `Build ${info.text}`]
      .filter(Boolean)
      .join("\n");
  return info;
}
