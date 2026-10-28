import hashes from "./media-manifest.json" with { type: "json" };

const base = new URL("./", import.meta.url);
const resolved = new Map();

// Media URLs carry their content hash so browsers can keep unchanged bytes.
export function mediaUrl(source) {
  if (typeof source !== "string" || !source) return source;
  if (resolved.has(source)) return resolved.get(source);
  let url;
  try {
    url = new URL(source, base);
  } catch {
    return source;
  }
  if (url.origin !== base.origin) return source;
  const path = url.pathname.startsWith(base.pathname)
    ? url.pathname.slice(base.pathname.length)
    : url.pathname.replace(/^\/card-game\//, "").replace(/^\//, "");
  const hash = hashes[path];
  if (!hash) return source;
  const target = new URL(path, base);
  target.search = url.search;
  target.hash = url.hash;
  target.searchParams.set("v", hash);
  const value = target.href;
  resolved.set(source, value);
  return value;
}
