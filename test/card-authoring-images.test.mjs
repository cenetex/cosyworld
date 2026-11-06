import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  authoringImageBasis,
  authoringImageReference,
  requestAuthoringImage,
  splitAuthoringPoseSheet,
} from "../v2/card-game/authoring-images.mjs";
const bytes = new Uint8Array(
  readFileSync("v2/card-game/assets/authoring-guide/dino-design.png"),
);
const image = {
  mime: "image/png",
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  base64: Buffer.from(bytes).toString("base64"),
};
const basis = authoringImageBasis("sample-vale", 2, image.sha256, 7);
const body = () => ({
  kind: "avatar",
  role: "portrait",
  description: "A gentle moss-green dinosaur.",
  basis,
});
const response = (change = {}) =>
  Response.json({
    image,
    basis,
    model: "configured-image-model",
    usage: { images: 1 },
    ...change,
  });
const decode = () => ({ width: 1536, height: 864, close() {} });

it("verifies the output and prepares the same saved Dino reference", async () => {
  const fetch = vi.fn(async () => response());
  const result = await requestAuthoringImage(body(), { fetch, decode });
  expect(result.image.sha256).toBe(image.sha256);
  expect(await authoringImageReference(result.image)).toEqual({
    base64: image.base64,
    mime: image.mime,
    sha256: image.sha256,
  });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body());
  expect(fetch.mock.calls[0][1]).toMatchObject({
    credentials: "same-origin",
    cache: "no-store",
  });
  expect(Object.keys(result).sort()).toEqual(
    "basis image model usage".split(" "),
  );
});

it("rejects a changed design, wrong response binding and damaged image", async () => {
  let current = true;
  await expect(
    requestAuthoringImage(body(), {
      decode,
      isCurrent: () => current,
      fetch: async () => {
        current = false;
        return response();
      },
    }),
  ).rejects.toThrow(/earlier design/);
  for (const change of [
    { basis: "older" },
    { image: { ...image, sha256: "0".repeat(64) } },
    { image: { ...image, size: 0 } },
  ])
    await expect(
      requestAuthoringImage(body(), {
        decode,
        fetch: async () => response(change),
      }),
    ).rejects.toThrow(/binding|digest/);
  const controller = new AbortController();
  controller.abort();
  const fetch = vi.fn();
  await expect(
    requestAuthoringImage(body(), { signal: controller.signal, fetch }),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it("bounds streamed JSON and preserves the typed account retry response", async () => {
  await expect(
    requestAuthoringImage(body(), {
      fetch: async () => new Response(new Uint8Array(12 * 1024 * 1024 + 1)),
    }),
  ).rejects.toThrow(/12 MiB/);
  await expect(
    requestAuthoringImage(body(), {
      fetch: async () =>
        Response.json(
          { error: "Sign in again.", code: "auth", retryAfterMs: 500 },
          { status: 401 },
        ),
    }),
  ).rejects.toMatchObject({
    message: "Sign in again.",
    status: 401,
    code: "auth",
    retryAfterMs: 500,
  });
});

it("requires a verified avatar reference for one pose sheet", async () => {
  const request = { ...body(), role: "pose-sheet" },
    fetch = vi.fn(async () => response());
  await expect(requestAuthoringImage(request, { fetch })).rejects.toThrow(
    /confirmed avatar/,
  );
  request.reference = await authoringImageReference({ bytes, ...image });
  await requestAuthoringImage(request, { fetch, decode });
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(
    requestAuthoringImage({ ...request, kind: "item" }, { fetch }),
  ).rejects.toThrow(/confirmed avatar/);
});

it("checks sheet dimensions before creating a canvas and closes decoded images", async () => {
  const canvas = vi.fn(),
    close = vi.fn();
  for (const dimensions of [
    [1024, 1024],
    [9000, 6000],
  ])
    await expect(
      splitAuthoringPoseSheet(
        { ...image, bytes },
        {
          canvas,
          decode: () => ({
            width: dimensions[0],
            height: dimensions[1],
            close,
          }),
        },
      ),
    ).rejects.toThrow(/columns|million pixels/);
  expect(canvas).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(2);
});
