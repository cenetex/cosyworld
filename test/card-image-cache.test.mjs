import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { reuseVariants } from "../v2/scripts/card-image-cache.mjs";

const hash = (body) => createHash("sha256").update(body).digest("hex");
const stage = "assets/optimized/stage/png/a.webp";
const cardPath = "assets/optimized/card/png/a.webp";
const stageBody = Buffer.from("stage bytes");
const cardBody = Buffer.from("card bytes");

function setup(files = { [stage]: stageBody, [cardPath]: cardBody }) {
  const saved = {
    sourceHash: "source",
    stage,
    stageHash: hash(stageBody),
    card: cardPath,
    cardHash: hash(cardBody),
  };
  const read = async (file) => {
    if (!files[file]) throw new Error("missing");
    return files[file];
  };
  return {
    saved,
    sourceHash: "source",
    stage,
    cardPath,
    settingsMatch: true,
    reencode: false,
    read,
    hash,
  };
}

describe("card image reuse", () => {
  it("reuses committed stage and card bytes for an unchanged source", async () => {
    const reused = await reuseVariants(setup());
    expect(reused.stageBody.equals(stageBody)).toBe(true);
    expect(reused.card).toBe(cardPath);
    expect(reused.cardBody.equals(cardBody)).toBe(true);
  });

  it("reuses a stage-only record", async () => {
    const options = setup({ [stage]: stageBody });
    options.saved.card = stage;
    options.saved.cardHash = options.saved.stageHash;
    const reused = await reuseVariants(options);
    expect(reused.card).toBe(stage);
    expect(reused.cardBody.equals(stageBody)).toBe(true);
  });

  it("encodes new, changed, or refreshed sources", async () => {
    const fresh = setup();
    fresh.saved = undefined;
    expect(await reuseVariants(fresh)).toBeNull();
    expect(
      await reuseVariants({ ...setup(), sourceHash: "edited" }),
    ).toBeNull();
    expect(
      await reuseVariants({ ...setup(), settingsMatch: false }),
    ).toBeNull();
    expect(await reuseVariants({ ...setup(), reencode: true })).toBeNull();
  });

  it("encodes when committed outputs are missing or edited", async () => {
    expect(await reuseVariants(setup({ [stage]: stageBody }))).toBeNull();
    expect(
      await reuseVariants(
        setup({ [stage]: Buffer.from("other"), [cardPath]: cardBody }),
      ),
    ).toBeNull();
    expect(
      await reuseVariants(
        setup({ [stage]: stageBody, [cardPath]: Buffer.from("other") }),
      ),
    ).toBeNull();
  });
});
