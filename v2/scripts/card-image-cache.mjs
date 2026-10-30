// Reuse committed card image variants when their source and encode settings
// are unchanged. Encoders differ between sharp releases and platforms, so the
// committed bytes stay the source of truth for unchanged art.

/**
 * @param {object} options
 * @param {object | undefined} options.saved previous image-variants.json record
 * @param {string} options.sourceHash hash of the current source image
 * @param {string} options.stage expected stage path for this source
 * @param {string} options.cardPath card path this source would use
 * @param {boolean} options.settingsMatch manifest version and settings unchanged
 * @param {boolean} options.reencode deliberate full refresh requested
 * @param {(file: string) => Promise<Buffer>} options.read reads a committed file
 * @param {(body: Buffer) => string} options.hash content hash
 * @returns {Promise<{ stageBody: Buffer, card: string, cardBody: Buffer } | null>}
 */
export async function reuseVariants({
  saved,
  sourceHash,
  stage,
  cardPath,
  settingsMatch,
  reencode,
  read,
  hash,
}) {
  if (reencode || !settingsMatch || !saved) return null;
  if (saved.sourceHash !== sourceHash || saved.stage !== stage) return null;
  if (saved.card !== stage && saved.card !== cardPath) return null;
  const load = async (file, expected) => {
    try {
      const body = await read(file);
      return hash(body) === expected ? body : null;
    } catch {
      return null;
    }
  };
  const stageBody = await load(stage, saved.stageHash);
  if (!stageBody) return null;
  if (saved.card === stage)
    return saved.cardHash === saved.stageHash
      ? { stageBody, card: stage, cardBody: stageBody }
      : null;
  const cardBody = await load(saved.card, saved.cardHash);
  if (!cardBody) return null;
  return { stageBody, card: saved.card, cardBody };
}
