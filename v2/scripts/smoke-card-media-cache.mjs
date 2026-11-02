import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import variants from "../card-game/image-variants.json" with { type: "json" };
import streams from "../card-game/music-streams.json" with { type: "json" };
import hashes from "../card-game/media-manifest.json" with { type: "json" };

const imagePath = variants.images["assets/shared/places/station.png"].stage;
const originalPath = "assets/music/pond-1.mp3";
const audioPath = streams[originalPath].file;
const original = readFileSync(
  new URL(`../card-game/${originalPath}`, import.meta.url),
);
const audioBytes = original.subarray(streams[originalPath].offset);
const imageBytes = readFileSync(
  new URL(`../card-game/${imagePath}`, import.meta.url),
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(digest(audioBytes), hashes[audioPath]);
assert.equal(digest(imageBytes), hashes[imagePath]);
const mediaPaths = new Set([
  `/card-game/${imagePath}`,
  `/card-game/${audioPath}`,
]);
const requests = [];
const browserRequests = [];
const externalOrigin = process.env.COSYWORLD_MEDIA_CACHE_ORIGIN;
let phase = "setup";
let server;
if (!externalOrigin) {
  server = createServer();
  const assetHandler = server.listeners("request")[0];
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/cache-check") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>Card media cache check</title><img id="stage" alt="Empty station"><audio id="music" preload="none"></audio>',
      );
      return;
    }
    if (mediaPaths.has(url.pathname)) {
      const record = {
        phase,
        path: url.pathname,
        query: url.search,
        range: req.headers.range || null,
        validator: req.headers["if-none-match"] || null,
        status: null,
        bytes: 0,
      };
      requests.push(record);
      const count = (chunk, encoding) => {
        if (
          chunk !== undefined &&
          chunk !== null &&
          typeof chunk !== "function"
        )
          record.bytes += Buffer.byteLength(
            chunk,
            typeof encoding === "string" ? encoding : undefined,
          );
      };
      const write = res.write;
      const end = res.end;
      res.write = function (chunk, ...args) {
        count(chunk, args[0]);
        return write.call(this, chunk, ...args);
      };
      res.end = function (chunk, ...args) {
        count(chunk, args[0]);
        return end.call(this, chunk, ...args);
      };
      res.once("finish", () => {
        record.status = res.statusCode;
      });
    }
    void assetHandler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}
const origin = externalOrigin
  ? new URL(externalOrigin).origin
  : `http://127.0.0.1:${server.address().port}`;
const documentPath = externalOrigin
  ? "/card-game/voices.json"
  : "/cache-check";
const browser = await chromium.launch({ headless: true });
const results = [];
const requestsIn = (name) =>
  (server ? requests : browserRequests).filter(
    (request) => request.phase === name,
  );
const byteCount = (records) =>
  records.reduce((total, record) => total + record.bytes, 0);

async function loadMedia(page) {
  return page.evaluate(
    async ({ imagePath, audioPath }) => {
      const { mediaUrl } = await import("/card-game/media.mjs");
      const targets = {
        image: mediaUrl(imagePath),
        audio: mediaUrl(audioPath),
      };
      const values = await Promise.all(
        Object.entries(targets).map(async ([kind, url]) => {
          const response = await fetch(url);
          if (!response.ok)
            throw new Error(`Media response: ${response.status}`);
          const bytes = await response.arrayBuffer();
          const hash = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("");
          if (hash !== new URL(url).searchParams.get("v"))
            throw new Error("Media hash changed.");
          return [kind, { url, bytes: bytes.byteLength, hash }];
        }),
      );
      if (!document.querySelector("#stage")) {
        document.body.replaceChildren();
        const stage = document.createElement("img");
        stage.id = "stage";
        const music = document.createElement("audio");
        music.id = "music";
        music.preload = "none";
        document.body.append(stage, music);
      }
      const image = document.querySelector("#stage");
      image.src = targets.image;
      await image.decode();
      const audio = document.querySelector("#music");
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Music metadata timed out.")),
          20000,
        );
        audio.addEventListener(
          "loadedmetadata",
          () => {
            clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
        audio.addEventListener(
          "error",
          () => {
            clearTimeout(timeout);
            reject(new Error(audio.error?.message || "Music metadata failed."));
          },
          { once: true },
        );
        audio.preload = "metadata";
        audio.src = targets.audio;
        audio.load();
      });
      const duration = audio.duration;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      return {
        values: Object.fromEntries(values),
        width: image.naturalWidth,
        height: image.naturalHeight,
        duration,
      };
    },
    { imagePath, audioPath },
  );
}

try {
  for (const width of [1440, 390]) {
    const prefix = `${width}px`;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
      const cacheHits = new Set();
      const network = new Map();
      const early = new Map();
      const header = (headers, name) =>
        Object.entries(headers || {}).find(
          ([key]) => key.toLowerCase() === name,
        )?.[1] || null;
      const update = (id, values) => {
        const record = network.get(id);
        if (record) Object.assign(record, values);
        else early.set(id, { ...early.get(id), ...values });
      };
      cdp.on("Network.requestWillBeSent", (event) => {
        const url = new URL(event.request.url);
        if (!mediaPaths.has(url.pathname)) return;
        const record = {
          phase,
          path: url.pathname,
          query: url.search,
          range: header(event.request.headers, "range"),
          validator: header(event.request.headers, "if-none-match"),
          status: null,
          bytes: 0,
          cached: false,
          ...early.get(event.requestId),
        };
        network.set(event.requestId, record);
        browserRequests.push(record);
        if (record.cached) cacheHits.add(event.requestId);
      });
      cdp.on("Network.requestWillBeSentExtraInfo", (event) =>
        update(event.requestId, {
          range: header(event.headers, "range"),
          validator: header(event.headers, "if-none-match"),
        }),
      );
      cdp.on("Network.requestServedFromCache", (event) => {
        update(event.requestId, { cached: true, bytes: 0 });
        if (network.has(event.requestId)) cacheHits.add(event.requestId);
      });
      cdp.on("Network.responseReceived", (event) => {
        const record = network.get(event.requestId);
        if (!record) return;
        record.status = record.wireStatus || event.response.status;
        if (event.response.fromDiskCache) {
          record.cached = true;
          record.bytes = 0;
          cacheHits.add(event.requestId);
        }
      });
      cdp.on("Network.responseReceivedExtraInfo", (event) => {
        update(event.requestId, {
          wireStatus: event.statusCode,
          status: event.statusCode,
        });
        if (event.statusCode === 304) update(event.requestId, { bytes: 0 });
      });
      cdp.on("Network.dataReceived", (event) => {
        const record = network.get(event.requestId);
        if (record && !record.cached && record.status !== 304)
          record.bytes += event.encodedDataLength;
      });
      cdp.on("Network.loadingFinished", (event) => {
        const record = network.get(event.requestId);
        if (
          record &&
          !record.cached &&
          record.status !== 304 &&
          record.bytes === 0
        )
          record.bytes = event.encodedDataLength;
      });
      await page.goto(`${origin}${documentPath}`);
      phase = `${prefix}:cold`;
      const cold = await loadMedia(page);
      assert.equal(cold.values.image.bytes, imageBytes.length);
      assert.equal(cold.values.audio.bytes, audioBytes.length);
      assert(cold.width > 100 && cold.height > 100);
      assert(Number.isFinite(cold.duration) && cold.duration > 30);
      assert(
        requestsIn(phase).some(
          (record) =>
            record.path.endsWith(".webp") &&
            record.status === 200 &&
            record.bytes > 0,
        ),
      );
      assert(
        requestsIn(phase).some(
          (record) =>
            record.path.endsWith(".mp3") &&
            record.status === 200 &&
            record.bytes > 0,
        ),
      );
      const coldBytes = byteCount(requestsIn(phase));
      phase = `${prefix}:warm`;
      const warm = await loadMedia(page);
      assert.deepEqual(warm, cold);
      assert.equal(
        byteCount(requestsIn(phase)),
        0,
        "Repeated media loads reuse cached bytes.",
      );
      phase = `${prefix}:reload`;
      await page.reload();
      const reloaded = await loadMedia(page);
      assert.deepEqual(reloaded, cold);
      assert.equal(
        byteCount(requestsIn(phase)),
        0,
        "Reload keeps the cached media bodies.",
      );
      assert(cacheHits.size >= 2, "Chromium reports media cache hits.");

      phase = `${prefix}:unversioned-first`;
      const unversioned = `${origin}/card-game/${imagePath}`;
      const first = await page.evaluate(async (url) => {
        const response = await fetch(url);
        await response.arrayBuffer();
        return { status: response.status, etag: response.headers.get("etag") };
      }, unversioned);
      assert.equal(first.status, 200);
      assert.equal(first.etag, `"${hashes[imagePath]}"`);
      phase = `${prefix}:unversioned-repeat`;
      const validated = await page.evaluate(async (url) => {
        const response = await fetch(url);
        return (await response.arrayBuffer()).byteLength;
      }, unversioned);
      assert.equal(validated, imageBytes.length);
      const validations = requestsIn(phase);
      assert.equal(validations.length, 1);
      assert.equal(validations[0].status, 304);
      assert.equal(validations[0].validator, first.etag);
      assert.equal(byteCount(validations), 0);

      phase = `${prefix}:ranges`;
      const rangeResults = await page.evaluate(
        async ({ path, hash, length }) => {
          const replies = [];
          for (const headers of [
            { Range: "bytes=0-2047", "If-Range": `"${hash}"` },
            { Range: "bytes=-128" },
            { Range: `bytes=${length}-` },
            { Range: "bytes=0-31", "If-Range": '"older"' },
          ]) {
            const response = await fetch(path, { headers, cache: "no-store" });
            const bytes = new Uint8Array(await response.arrayBuffer());
            replies.push({
              status: response.status,
              range: response.headers.get("content-range"),
              length: bytes.length,
              sample: Array.from(bytes.slice(0, 2048)),
            });
          }
          return replies;
        },
        {
          path: `${origin}/card-game/${audioPath}`,
          hash: hashes[audioPath],
          length: audioBytes.length,
        },
      );
      assert.equal(rangeResults[0].status, 206);
      assert.equal(rangeResults[0].range, `bytes 0-2047/${audioBytes.length}`);
      assert.equal(rangeResults[0].length, 2048);
      assert.deepEqual(
        rangeResults[0].sample,
        Array.from(audioBytes.subarray(0, 2048)),
      );
      assert.equal(rangeResults[1].status, 206);
      assert.equal(
        rangeResults[1].range,
        `bytes ${audioBytes.length - 128}-${audioBytes.length - 1}/${audioBytes.length}`,
      );
      assert.deepEqual(
        rangeResults[1].sample,
        Array.from(audioBytes.subarray(-128)),
      );
      assert.equal(rangeResults[2].status, 416);
      assert.equal(rangeResults[2].range, `bytes */${audioBytes.length}`);
      assert.equal(rangeResults[2].length, 0);
      assert.equal(rangeResults[3].status, 200);
      assert.equal(rangeResults[3].range, null);
      assert.equal(rangeResults[3].length, audioBytes.length);
      assert.deepEqual(errors, []);
      results.push({
        width,
        imageBytes: imageBytes.length,
        audioBytes: audioBytes.length,
        coldBytes,
        warmBytes: byteCount(requestsIn(`${prefix}:warm`)),
        reloadBytes: byteCount(requestsIn(`${prefix}:reload`)),
        browserCacheHits: cacheHits.size,
        unversionedRevalidation: validations[0].status,
        relativeRanges: true,
        browserErrors: errors.length,
      });
    } finally {
      await context.close();
    }
  }
  console.log(
    JSON.stringify({
      origin,
      delivery: server ? "node" : "external",
      mediaCacheChecks: results,
    }),
  );
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
