import {
  authoringImageBasis,
  authoringImageReference,
  POSE_ROLES,
  requestAuthoringImage,
  splitAuthoringPoseSheet,
} from "./authoring-images.mjs";

const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const description = (value) => value.trim().replace(/\s+/gu, " ");
const described = (value) =>
  typeof value === "string" &&
  value.trim() &&
  value.length <= 1200 &&
  value.isWellFormed() &&
  !/[\u0000-\u001f\u007f]/u.test(description(value));
// One open design owns its request and preview. Confirm supplies output bytes only.
export function createAuthoringVisualDraft({
  request = requestAuthoringImage,
  reference = authoringImageReference,
  split = splitAuthoringPoseSheet,
  changed = () => {},
} = {}) {
  let current = null,
    pending = null,
    controller,
    epoch = 0,
    busy = "",
    error = "",
    confirmedText = "",
    status = 0;
  const notify = () => changed(api.state);
  const editable = () =>
    need(busy !== "saving", "Wait for this design to finish saving.");
  function cancel() {
    editable();
    epoch++;
    controller?.abort();
    busy = "";
  }
  async function roll(role, instruction = "", example) {
    editable();
    need(
      current && ["portrait", "pose-sheet"].includes(role),
      "Choose an open card and image role.",
    );
    need(
      described(current.description),
      "Describe this card within 1200 characters.",
    );
    need(
      typeof instruction === "string" && instruction.length <= 2000,
      "Describe image changes within 2000 characters.",
    );
    need(
      role !== "pose-sheet" ||
        (current.kind === "avatar" &&
          api.state.confirmed &&
          pending?.role !== "portrait"),
      "Confirm an avatar portrait before rolling poses.",
    );
    const base =
      role === "pose-sheet"
        ? current.base
        : instruction.trim()
          ? pending?.role === "portrait"
            ? pending.images[0]
            : current.base
          : null;
    need(!instruction.trim() || base, "Choose an image to edit.");
    cancel();
    const token = epoch,
      design = current;
    controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(215_000),
    ]);
    const revision =
      role === "portrait" ? design.revision + 1 : design.revision;
    const basis = authoringImageBasis(
      design.id,
      revision,
      base?.sha256 ?? null,
      token,
    );
    const options = { signal, basis, isCurrent: () => token === epoch };
    busy = example ? "reading" : "rolling";
    error = "";
    status = 0;
    notify();
    try {
      const imageReference = base && !example ? await reference(base) : null;
      if (token !== epoch) return;
      signal.throwIfAborted();
      const result = example
        ? { image: example }
        : await request(
            {
              kind: design.kind,
              role,
              description: description(design.description),
              basis,
              ...(imageReference ? { reference: imageReference } : {}),
              ...(instruction.trim() ? { instruction } : {}),
            },
            options,
          );
      if (token !== epoch) return;
      const sheet =
        role === "pose-sheet" ? await split(result.image, options) : null;
      if (token !== epoch) return;
      pending = {
        role,
        revision,
        basis,
        images: sheet
          ? [{ ...design.base, role: "base" }, sheet.sheet, ...sheet.cells]
          : [{ ...result.image, role: "base" }],
      };
    } catch (failure) {
      if (token === epoch) {
        error =
          failure.name === "TimeoutError"
            ? "The image is taking longer than expected. Check this card again shortly."
            : failure.message;
        status = failure.status || 0;
      }
    } finally {
      if (token === epoch) {
        busy = "";
        notify();
      }
    }
  }
  const api = {
    get state() {
      const poses =
        pending?.role === "pose-sheet" ? pending.images : current?.poses || [];
      return {
        id: current?.id,
        description: current?.description || "",
        described: !!described(current?.description),
        revision: current?.revision,
        image: pending?.role === "portrait" ? pending.images[0] : current?.base,
        poses: poses.filter((image) => POSE_ROLES.includes(image.role)),
        sheet: poses.find((image) => image.role === "sheet"),
        role: pending?.role || null,
        confirmed:
          !!current?.base && description(current.description) === confirmedText,
        busy,
        error,
        status,
      };
    },
    open(value) {
      editable();
      if (value) {
        need(
          ["avatar", "location", "item"].includes(value.kind),
          "Choose an avatar, location or item.",
        );
        authoringImageBasis(
          value.id,
          value.revision,
          value.base?.sha256 ?? null,
          0,
        );
        need(
          typeof value.description === "string",
          "Enter a description for this card.",
        );
      }
      cancel();
      current = value ? structuredClone(value) : null;
      confirmedText = current ? description(current.description) : "";
      pending = null;
      error = "";
      status = 0;
      notify();
    },
    describe(value) {
      editable();
      need(
        current && typeof value === "string",
        "Enter a description for this card.",
      );
      if (value === current.description) return;
      cancel();
      current.description = value;
      pending = null;
      error = "";
      status = 0;
      notify();
    },
    cancel() {
      cancel();
      notify();
    },
    discard() {
      cancel();
      pending = null;
      error = "";
      status = 0;
      notify();
    },
    roll: (role = "portrait", instruction = "") => roll(role, instruction),
    // A finished job image, read back from the server, becomes the preview.
    adopt: (role, image) => roll(role, "", image),
    reviewSheet(image) {
      need(image, "Open the saved pose sheet.");
      return roll("pose-sheet", "", image);
    },
    async confirm(save) {
      editable();
      need(pending && !busy, "Review an image before confirming it.");
      need(
        described(current.description),
        "Describe this card within 1200 characters.",
      );
      const reviewed = pending;
      const output = structuredClone({
        description: description(current.description),
        images: reviewed.images.map(({ role, mime, bytes }) => ({
          role,
          mime,
          bytes,
        })),
      });
      busy = "saving";
      error = "";
      status = 0;
      notify();
      try {
        await save(output);
        current.description = output.description;
        confirmedText = output.description;
        current.base = reviewed.images[0];
        current.poses =
          reviewed.role === "pose-sheet" ? reviewed.images.slice(1) : [];
        current.revision = reviewed.revision;
        pending = null;
        return true;
      } catch (failure) {
        error = failure.message;
        status = failure.status || 0;
        return false;
      } finally {
        busy = "";
        notify();
      }
    },
  };
  return api;
}
