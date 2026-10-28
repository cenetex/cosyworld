import variants from "./image-variants.json" with { type: "json" };
import { mediaUrl } from "./media.mjs";

const base = new URL("./", import.meta.url);
const resolved = new Map();

// Catalog paths keep their identity; each view chooses the image it needs.
export function imageUrl(source, size = "stage") {
  if (typeof source !== "string" || !source) return source;
  const key = `${size}:${source}`;
  if (resolved.has(key)) return resolved.get(key);
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
  const image = variants.images[path];
  if (!image) return mediaUrl(source);
  const target = new URL(image[size === "card" ? "card" : "stage"], base);
  target.search = url.search;
  target.hash = url.hash;
  const value = mediaUrl(target.href);
  resolved.set(key, value);
  return value;
}
