import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { fakeJobs } from "./helpers/fake-jobs.mjs";
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
const decode = () => ({ width: 1536, height: 864, close() {} });
// The job server makes the image once; the client reads it back by digest.
function jobs(change = {}, polls = 1) {
  const stored = () => {
    const file = server.put(bytes);
    if (change.corrupt) server.assets.set(file.sha256, bytes.slice().fill(7));
    return file;
  };
  const server = fakeJobs({
    polls,
    auto: (_kind, request) =>
      change.error
        ? { error: change.error }
        : {
            image: stored(),
            basis: request.basis,
            model: "configured-image-model",
            usage: { images: 1 },
            ...change.result,
          },
  });
  return server;
}
const invoke = (server, options = {}) =>
  requestAuthoringImage(body(), {
    decode,
    fetch: server.fetch,
    env: server.env,
    ...options,
  });

it("verifies the output and prepares the same saved Dino reference", async () => {
  const server = jobs();
  const result = await invoke(server);
  expect(result.image.sha256).toBe(image.sha256);
  expect(await authoringImageReference(result.image)).toEqual({
    base64: image.base64,
    mime: image.mime,
    sha256: image.sha256,
  });
  expect(server.posts).toHaveLength(1);
  expect(server.posts[0]).toMatchObject({ kind: "image", request: body() });
  expect(server.posts[0].key).toMatch(/^[0-9a-f-]{36}$/u);
});

it("rejects a changed design, wrong response binding and damaged image", async () => {
  let current = true;
  const server = jobs();
  const finish = server.fetch;
  await expect(
    invoke(server, {
      isCurrent: () => current,
      fetch: async (url, init) => {
        const out = await finish(url, init);
        if (String(url).includes("/assets/")) current = false;
        return out;
      },
    }),
  ).rejects.toThrow(/earlier design/);
  await expect(invoke(jobs({ result: { basis: "older" } }))).rejects.toThrow(
    /binding/,
  );
  await expect(
    invoke(jobs({ result: { image: { ...image, sha256: "0".repeat(64), size: 5, mime: "image/png" } } })),
  ).rejects.toThrow();
  await expect(invoke(jobs({ corrupt: true }))).rejects.toThrow(/digest/);
  await expect(
    invoke(jobs({ result: { image: { ...image, size: 0, mime: "image/png" } } })),
  ).rejects.toThrow(/size/);
  const controller = new AbortController();
  controller.abort();
  const idle = jobs();
  await expect(invoke(idle, { signal: controller.signal })).rejects.toThrow();
  expect(idle.posts).toHaveLength(0);
});

it("reports a refused request and a failed job with the server's message", async () => {
  const refused = jobs();
  refused.refuseNext(401, { error: "Sign in again.", code: "auth", retryAfterMs: 500 });
  await expect(invoke(refused)).rejects.toMatchObject({
    message: "Sign in again.",
    status: 401,
    code: "auth",
  });
  const failed = jobs({
    error: {
      message: "The image could not be used.",
      code: "image_layout_invalid",
      retryAfterMs: 0,
    },
  });
  await expect(invoke(failed)).rejects.toMatchObject({
    message: "The image could not be used.",
    code: "image_layout_invalid",
  });
});

it("requires a verified avatar reference for one pose sheet", async () => {
  const request = { ...body(), role: "pose-sheet" },
    server = jobs();
  const options = { fetch: server.fetch, env: server.env, decode };
  await expect(requestAuthoringImage(request, options)).rejects.toThrow(
    /confirmed avatar/,
  );
  request.reference = await authoringImageReference({ bytes, ...image });
  await requestAuthoringImage(request, options);
  expect(server.posts).toHaveLength(1);
  await expect(
    requestAuthoringImage(
      {
        ...request,
        basis: authoringImageBasis("sample-vale", 2, "0".repeat(64), 7),
      },
      options,
    ),
  ).rejects.toThrow(/confirmed portrait/);
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
