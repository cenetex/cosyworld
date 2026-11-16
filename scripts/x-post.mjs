#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.x.com";
const QUEUE = "v2/social/x-posts.json";
const ASSETS = "v2/card-game";
const CHUNK = 4 * 1024 * 1024;
const LIMIT = 280;
const NAMES = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"];

const encode = (text) =>
  encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function baseString(method, url, params) {
  const pairs = Object.entries(params)
    .map(([key, value]) => [encode(key), encode(String(value))])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return [method.toUpperCase(), encode(url), encode(pairs)].join("&");
}

export function authorization(method, target, keys, { nonce, timestamp } = {}) {
  const parsed = new URL(target);
  const oauth = {
    oauth_consumer_key: keys.X_API_KEY,
    oauth_nonce: nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: keys.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const base = baseString(method, parsed.origin + parsed.pathname, {
    ...Object.fromEntries(parsed.searchParams),
    ...oauth,
  });
  const secret = `${encode(keys.X_API_SECRET)}&${encode(keys.X_ACCESS_TOKEN_SECRET)}`;
  oauth.oauth_signature = createHmac("sha1", secret).update(base).digest("base64");
  const fields = Object.entries(oauth)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${encode(key)}="${encode(value)}"`);
  return `OAuth ${fields.join(", ")}`;
}

export function day(start, today) {
  const at = (text) => Date.parse(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start ?? "") || Number.isNaN(at(start))) return null;
  return Math.round((at(today) - at(start)) / 86400000) + 1;
}

export function due(queue, start, today) {
  const number = day(start, today);
  if (number === null) return [];
  return queue.posts.filter((post) => post.approved === true && post.day === number);
}

export function problems(queue) {
  const found = [];
  const seen = new Set();
  for (const post of queue.posts) {
    if (seen.has(post.id)) found.push(`${post.id}: the id is used twice`);
    seen.add(post.id);
    if (!Number.isInteger(post.day) || post.day < 1) found.push(`${post.id}: day must be 1 or more`);
    if (!post.text || Array.from(post.text).length > LIMIT) found.push(`${post.id}: text must be 1 to ${LIMIT} characters`);
    if (typeof post.approved !== "boolean") found.push(`${post.id}: approved must be true or false`);
    if (Boolean(post.portrait) !== Boolean(post.voice)) found.push(`${post.id}: a voice post needs both portrait and voice`);
    if (post.video && post.portrait) found.push(`${post.id}: a post has a ready video or a portrait, not both`);
    if (post.video && path.basename(post.video) !== post.video) found.push(`${post.id}: video must be a file name`);
  }
  return found;
}

function keys(env) {
  const missing = NAMES.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}.`);
  return Object.fromEntries(NAMES.map((name) => [name, env[name]]));
}

async function call(method, target, secrets, { json, form } = {}) {
  const headers = { authorization: authorization(method, target, secrets) };
  if (json) headers["content-type"] = "application/json";
  const response = await fetch(target, { method, headers, body: json ? JSON.stringify(json) : form });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${new URL(target).pathname} answered ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

export function video(post, out) {
  const file = path.join(out, `${post.id}.mp4`);
  execFileSync(
    "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=0x14110f:s=1080x1350:r=25",
      "-loop", "1", "-i", path.join(root, ASSETS, post.portrait),
      "-i", path.join(root, ASSETS, post.voice),
      "-filter_complex",
      "[1:v]scale=1000:1270:force_original_aspect_ratio=decrease[p];[0:v][p]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]",
      "-map", "[v]", "-map", "2:a",
      "-c:v", "libx264", "-tune", "stillimage", "-preset", "veryfast", "-crf", "26",
      "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
      file,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  return file;
}

async function upload(file, secrets) {
  const bytes = readFileSync(file);
  const started = await call("POST", `${API}/2/media/upload/initialize`, secrets, {
    json: { media_type: "video/mp4", media_category: "tweet_video", total_bytes: statSync(file).size },
  });
  const id = started.data.id;
  for (let index = 0; index * CHUNK < bytes.length; index += 1) {
    const form = new FormData();
    form.set("segment_index", String(index));
    form.set("media", new Blob([bytes.subarray(index * CHUNK, (index + 1) * CHUNK)]), "chunk.mp4");
    await call("POST", `${API}/2/media/upload/${id}/append`, secrets, { form });
  }
  let state = (await call("POST", `${API}/2/media/upload/${id}/finalize`, secrets)).data?.processing_info;
  for (let tries = 0; state && state.state !== "succeeded"; tries += 1) {
    if (state.state === "failed" || tries >= 40) throw new Error(`X could not process the video for ${path.basename(file)}.`);
    await new Promise((resolve) => setTimeout(resolve, (state.check_after_secs ?? 3) * 1000));
    state = (await call("GET", `${API}/2/media/upload?command=STATUS&media_id=${id}`, secrets)).data?.processing_info;
  }
  return id;
}

async function main(argv, env) {
  const flag = (name) => argv.includes(name);
  const value = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  if (flag("--whoami")) {
    const me = await call("GET", `${API}/2/users/me`, keys(env));
    console.log(`[x-post] These keys post as @${me.data.username}.`);
    return;
  }
  const queue = JSON.parse(readFileSync(path.join(root, QUEUE), "utf8"));
  const wrong = problems(queue);
  if (wrong.length) throw new Error(`The queue has problems:\n${wrong.join("\n")}`);
  const today = value("--date") ?? new Date().toISOString().slice(0, 10);
  const start = value("--start") ?? env.X_CAMPAIGN_START;
  const posts = due(queue, start, today);
  const number = day(start, today);
  console.log(`[x-post] ${today} is day ${number ?? "unset (no start date)"}; ${posts.length} approved post(s) due.`);
  const out = mkdtempSync(path.join(tmpdir(), "x-post-"));
  for (const post of posts) {
    const ready = post.video && path.resolve(root, env.X_MEDIA_DIR ?? "v2/social/media", post.video);
    if (ready && !existsSync(ready)) {
      console.log(`[x-post] skipped ${post.id}: ${post.video} is not on this machine. Run it by hand where the file is.`);
      continue;
    }
    const file = ready || (post.portrait ? video(post, out) : null);
    if (!flag("--post")) {
      console.log(`[x-post] dry run ${post.id}${file ? ` with ${path.basename(file)}` : ""}:\n${post.text}\n`);
      continue;
    }
    const secrets = keys(env);
    const media = file ? { media: { media_ids: [await upload(file, secrets)] } } : {};
    const sent = await call("POST", `${API}/2/tweets`, secrets, { json: { text: post.text, ...media } });
    console.log(`[x-post] posted ${post.id} as ${sent.data.id}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env).catch((error) => {
    console.error(`[x-post] ${error.message}`);
    process.exitCode = 1;
  });
}
