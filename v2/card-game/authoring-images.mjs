import { assetMetadata } from "./authoring-draft.mjs";
import { fetchJobImage, runJob } from "./authoring-jobs.mjs";

export const POSE_ROLES = Object.freeze(
  "happy sad strike brace hit sleep".split(" "),
);
const MIB = 1024 * 1024,
  MAX_IMAGE = 8 * MIB;
const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hex = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
function guard({ signal, isCurrent = () => true }, basis) {
  signal?.throwIfAborted();
  need(
    isCurrent(basis),
    "This image belongs to an earlier design. Review the current card.",
  );
}
export function authoringImageBasis(candidate, revision, sha256, epoch) {
  need(
    typeof candidate === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/u.test(candidate) &&
      [revision, epoch].every((v) => Number.isSafeInteger(v) && v >= 0) &&
      (sha256 === null || hex(sha256)),
    "Choose a candidate, visual revision and confirmed portrait.",
  );
  return JSON.stringify([candidate, revision, sha256, epoch]);
}
async function checkedImage(image, limit = MAX_IMAGE) {
  const { mime, bytes } = image;
  need(
    ["image/png", "image/webp"].includes(mime) &&
      bytes instanceof Uint8Array &&
      bytes.length > 0 &&
      bytes.length <= limit,
    "Choose a PNG or WebP within the image byte limit.",
  );
  const copy = bytes.slice(),
    head = new TextDecoder("latin1").decode(copy.subarray(0, 16));
  need(
    mime === "image/png"
      ? copy[0] === 137 &&
          head.slice(1, 4) === "PNG" &&
          head.slice(12, 16) === "IHDR"
      : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP",
    "Check the image format.",
  );
  const meta = await assetMetadata(
    mime === "image/png" ? "image.png" : "image.webp",
    mime,
    copy,
  );
  need(
    (image.size === undefined || image.size === meta.size) &&
      (image.sha256 === undefined || image.sha256 === meta.sha256),
    "Check the image size and digest.",
  );
  return { bytes: copy, mime, sha256: meta.sha256, size: meta.size };
}
export async function authoringImageReference(image) {
  const checked = await checkedImage(image);
  let text = "";
  for (let i = 0; i < checked.bytes.length; i += 32768)
    text += String.fromCharCode(...checked.bytes.subarray(i, i + 32768));
  return { base64: btoa(text), mime: checked.mime, sha256: checked.sha256 };
}
function fromBase64(image) {
  need(
    typeof image?.base64 === "string" &&
      image.base64.length <= Math.ceil(MAX_IMAGE / 3) * 4 &&
      hex(image.sha256),
    "Choose a bounded image response with its digest.",
  );
  return {
    ...image,
    bytes: Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0)),
  };
}
async function bitmap(image, decode = createImageBitmap) {
  const result = await decode(new Blob([image.bytes], { type: image.mime }));
  if (
    !(
      result.width > 0 &&
      result.height > 0 &&
      result.width * result.height <= 16_000_000
    )
  ) {
    result.close();
    throw new Error("Keep the decoded image within 16 million pixels.");
  }
  return result;
}
export async function requestAuthoringImage(body, options = {}) {
  body = structuredClone(body);
  need(
    body &&
      Object.keys(body).every((key) =>
        "kind role description instruction reference basis"
          .split(" ")
          .includes(key),
      ) &&
      ["avatar", "location", "item"].includes(body.kind) &&
      ["portrait", "pose-sheet"].includes(body.role) &&
      typeof body.description === "string" &&
      body.description.trim() &&
      body.description.length <= 1200 &&
      (body.instruction === undefined ||
        (typeof body.instruction === "string" &&
          body.instruction.length <= 2000)) &&
      typeof body.basis === "string" &&
      body.basis.length <= 512,
    "Choose an image role, description and current design binding.",
  );
  const binding = JSON.parse(body.basis);
  need(
    Array.isArray(binding) &&
      binding.length === 4 &&
      authoringImageBasis(...binding) === body.basis,
    "Use the current candidate, visual revision, portrait digest and request epoch.",
  );
  need(
    body.role !== "pose-sheet" || (body.kind === "avatar" && body.reference),
    "Choose a confirmed avatar portrait for the pose sheet.",
  );
  if (body.reference)
    need(
      binding[2] === (await checkedImage(fromBase64(body.reference))).sha256,
      "Use the confirmed portrait named by this design binding.",
    );
  need(
    !body.instruction || body.reference,
    "Choose a reference image for these changes.",
  );
  guard(options, body.basis);
  // The job runs on the server; this waits for it and reads the stored image.
  const result = await runJob("image", body, options);
  guard(options, body.basis);
  need(
    result?.basis === body.basis,
    "This image response has a different design binding.",
  );
  need(
    Number.isSafeInteger(result.image?.size),
    "Check the image response size.",
  );
  const bytes = await fetchJobImage(result.image, options);
  guard(options, body.basis);
  const image = await checkedImage({
    mime: result.image.mime,
    bytes,
    size: result.image.size,
    sha256: result.image.sha256,
  });
  const decoded = await bitmap(image, options.decode);
  decoded.close();
  guard(options, body.basis);
  return {
    image,
    basis: result.basis,
    model: result.model,
    usage: result.usage,
  };
}

// The same loader handles a generated sheet and the preconfirmed Dino example.
export async function splitAuthoringPoseSheet(input, options = {}) {
  guard(options, options.basis);
  const sheet = await checkedImage(input),
    decoded = await bitmap(sheet, options.decode);
  try {
    guard(options, options.basis);
    need(
      decoded.width % 3 === 0 && decoded.height % 2 === 0,
      "Use a pose sheet with three equal columns and two equal rows.",
    );
    const width = decoded.width / 3,
      height = decoded.height / 2;
    const canvas = (options.canvas || ((w, h) => new OffscreenCanvas(w, h)))(
      width,
      height,
    );
    const context = canvas.getContext("2d");
    need(context, "Open this sheet in a browser with image canvas support.");
    const cells = [];
    let total = sheet.size;
    for (const [i, role] of POSE_ROLES.entries()) {
      guard(options, options.basis);
      context.clearRect(0, 0, width, height);
      context.drawImage(
        decoded,
        (i % 3) * width,
        Math.floor(i / 3) * height,
        width,
        height,
        0,
        0,
        width,
        height,
      );
      const blob = await canvas.convertToBlob({ type: "image/png" });
      need(blob.size <= 16 * MIB, "Keep each pose within 16 MiB.");
      const image = await checkedImage(
        { mime: "image/png", bytes: new Uint8Array(await blob.arrayBuffer()) },
        16 * MIB,
      );
      total += image.size;
      need(total <= 256 * MIB, "Keep the sheet and poses within 256 MiB.");
      cells.push({ ...image, role });
    }
    guard(options, options.basis);
    return { sheet: { ...sheet, role: "sheet" }, cells, width, height };
  } finally {
    decoded.close();
  }
}
