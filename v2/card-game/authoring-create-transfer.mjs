import { assetMetadata, DRAFT_LIMITS, exportManifest, parseDraft } from "./authoring-draft.mjs";

const fail = (message, status = 0) => Object.assign(new Error(message), { status });
const need = (ok, message, status) => {
  if (!ok) throw fail(message, status);
};
const content = ({ id: _id, revision: _revision, ...source }) => source;
const canonical = (value) =>
  JSON.stringify(value, (_key, next) =>
    next && typeof next === "object" && !Array.isArray(next)
      ? Object.fromEntries(
          Object.keys(next)
            .sort()
            .map((key) => [key, next[key]]),
        )
      : next,
  );

// Retry always reads the durable Create. The editable local draft stays separate.
export async function transferAuthoringCreate(
  store,
  operation,
  { fetch: fetcher = globalThis.fetch, signal, progress = () => {}, timeoutMs = 150_000 } = {},
) {
  const { draftKey, owner, requestKey } = operation;
  need(
    typeof owner === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(owner),
    "Choose the account that started Create.",
  );
  need(
    typeof requestKey === "string" &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(requestKey),
    "Open the saved Create request.",
  );
  need(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 150_000,
    "Use a bounded transfer timeout.",
  );
  const saved = await store.readCreate(draftKey, owner);
  need(
    saved?.requestKey === requestKey && saved.owner === owner && saved.draftKey === draftKey,
    "Open the saved Create for this account and world.",
  );
  const draft = parseDraft(exportManifest(saved.draft));
  need(draft.title.trim(), "Name this world before creating its private pack.");
  const headers = {
    Accept: "application/json",
    "X-Authoring-Owner": owner,
    "Idempotency-Key": requestKey,
  };
  async function request(path, method = "GET", body, mime, limit = 64 * 1024) {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)].filter(Boolean));
    bounded.throwIfAborted();
    const response = await fetcher(path, {
      method,
      body,
      signal: bounded,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { ...headers, ...(mime ? { "Content-Type": mime } : {}) },
    });
    const reader = response.body?.getReader(),
      chunks = [];
    const abort = () => {
      void reader?.cancel().catch(() => {});
    };
    bounded.addEventListener("abort", abort, { once: true });
    let size = 0,
      complete = false;
    try {
      need(!response.redirected, "Retry this transfer on the current site.");
      need(
        Number(response.headers.get("content-length") || 0) <= limit,
        "The transfer reply is too large.",
      );
      need(reader, "The transfer reply was empty.");
      while (true) {
        bounded.throwIfAborted();
        const next = await reader.read();
        bounded.throwIfAborted();
        if (next.done) break;
        size += next.value.byteLength;
        need(size <= limit, "The transfer reply is too large.");
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!response.ok || value?.error)
        throw fail(
          typeof value?.error === "string" ? value.error.slice(0, 300) : "Retry this saved Create.",
          response.status,
        );
      complete = true;
      return value;
    } catch (error) {
      if (!response.ok) throw fail(error.message, response.status);
      throw error;
    } finally {
      bounded.removeEventListener("abort", abort);
      if (!complete) await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
  }
  progress({ phase: "account" });
  const account = await request("/auth/account");
  need(
    account?.authenticated && typeof account.user_id === "string",
    "Sign in to finish this saved Create.",
    401,
  );
  need(account.user_id === owner, "Open the account that started this transfer.", 409);
  const checkedReceipt = (value) => {
    const receipt = parseDraft(exportManifest(value));
    need(
      receipt.id !== null &&
        receipt.revision === 1 &&
        canonical(content(receipt)) === canonical(content(draft)),
      "The receipt belongs to different world content. Retry the saved Create.",
    );
    return receipt;
  };
  if (saved.receipt) {
    const receipt = checkedReceipt(saved.receipt);
    progress({ phase: "complete", completed: 0, total: 0 });
    return receipt;
  }
  const body = JSON.stringify({ ...content(draft), launch: saved.launch ?? null });
  need(
    new TextEncoder().encode(body).length <= DRAFT_LIMITS.metadata,
    "Keep Create metadata under 10 MiB.",
  );
  need(
    saved.assets instanceof Map && saved.assets.size === draft.assets.length,
    "Open all saved Create files.",
  );
  const files = new Map(),
    // Originals made by a generation job are already in the owner's store.
    originals = new Set();
  for (const meta of draft.assets) {
    signal?.throwIfAborted();
    const bytes = saved.assets.get(meta.path);
    need(
      bytes instanceof Uint8Array && bytes.byteLength === meta.size,
      "Open the saved Create file bytes.",
    );
    const actual = await assetMetadata(meta.path, meta.mime, bytes);
    need(actual.sha256 === meta.sha256, "Check the saved Create file digest.");
    files.set(meta.sha256, bytes);
    if (meta.path.startsWith("assets/generated-art/"))
      originals.add(meta.sha256);
  }
  // A header-only probe costs no bytes; any doubt falls back to the upload.
  async function stored(sha256, size) {
    try {
      const response = await fetcher(`/card-game/authoring/assets/${sha256}`, {
        method: "HEAD",
        signal: AbortSignal.any(
          [signal, AbortSignal.timeout(timeoutMs)].filter(Boolean),
        ),
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers,
      });
      return (
        response.ok && Number(response.headers.get("content-length")) === size
      );
    } catch {
      signal?.throwIfAborted();
      return false;
    }
  }
  let completed = 0;
  for (const [sha256, bytes] of files) {
    progress({ phase: "upload", completed, total: files.size });
    if (originals.has(sha256) && (await stored(sha256, bytes.byteLength))) {
      completed++;
      continue;
    }
    const reply = await request(
      `/card-game/authoring/assets/${sha256}`,
      "PUT",
      bytes,
      "application/octet-stream",
    );
    need(
      reply?.sha256 === sha256 && reply.size === bytes.byteLength,
      "Check the uploaded file receipt.",
    );
    completed++;
  }
  progress({ phase: "create", completed, total: files.size });
  const receipt = checkedReceipt(
    await request(
      "/card-game/authoring/packs",
      "POST",
      body,
      "application/json",
      DRAFT_LIMITS.metadata,
    ),
  );
  signal?.throwIfAborted();
  const acknowledged = await store.finishCreate(draftKey, owner, requestKey, receipt);
  const result = checkedReceipt(acknowledged.receipt);
  progress({ phase: "complete", completed, total: files.size });
  return result;
}
