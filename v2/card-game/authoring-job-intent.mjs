// Keep the request's identity before paid work. Bodies and image bytes are hashed,
// never stored; metadata is the same bounded information used to adopt a reply.
export const jobDigest = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

export async function prepareJobIntent(
  store,
  identity,
  metadata,
  kind,
  request,
) {
  const owner = identity?.user_id,
    revision = identity?.account_revision;
  if (!identity?.authenticated || !owner)
    throw Object.assign(new Error("Sign in before drawing."), {
      status: 401,
      code: "sign_in_required",
    });
  if (
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !metadata.draftKey ||
    typeof store.claimJob !== "function"
  )
    throw new Error("Sign in and save this draft before drawing.");
  // Only existing adoption fields are accepted, never a generic request object.
  metadata = Object.fromEntries(
    Object.entries(metadata).filter(([key]) =>
      [
        "draftKey",
        "generation",
        "tool",
        "toolId",
        "avatarId",
        "variant",
        "role",
        "description",
        "basis",
        "binding",
        "input",
        "mode",
        "sample",
      ].includes(key),
    ),
  );
  if (JSON.stringify(metadata).length > 128 * 1024)
    throw new Error("Keep this draw's recovery details within 128 KiB.");
  const normalized = structuredClone(request),
    binding = { ...metadata };
  // A local press epoch prevents stale UI updates, but is not a new paid intent.
  // Restore the saved wire basis only after every other request field matches.
  if (kind === "image") {
    const basis = JSON.parse(normalized.basis);
    basis[3] = 0;
    normalized.basis = JSON.stringify(basis);
    binding.basis = normalized.basis;
  }
  const fingerprint = await jobDigest([
    owner,
    revision,
    kind,
    binding,
    normalized,
  ]);
  const proposed = {
    ...metadata,
    id: `intent_${fingerprint}`,
    owner,
    revision,
    kind,
    requestKey: crypto.randomUUID(),
    requestDigest: await jobDigest(request),
    createdAt: Date.now(),
    phase: "prepared",
  };
  const saved = await store.claimJob(proposed);
  if (kind === "image") request.basis = saved.basis;
  if (saved.requestDigest !== (await jobDigest(request)))
    throw new Error(
      "This request changed. Open its original draft before trying again.",
    );
  // After server retention expires, absence cannot prove the request never ran.
  if (Date.now() - saved.createdAt >= 7 * 24 * 3600_000)
    throw new Error(
      "This older draw needs review before starting another paid request.",
    );
  return saved;
}
