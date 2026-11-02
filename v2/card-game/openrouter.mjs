// Player-owned credentials stay in this tab's session storage.
const API = "https://openrouter.ai/api/v1/";
const CONNECTION = "cosy.openrouter.connection.v1";
const PENDING = "cosy.openrouter.pkce.v1";
const encode = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

// Provider text is shown as one short, plain line.
function errorText(value) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

export function createOpenRouter({
  storage,
  crypto = globalThis.crypto,
  fetcher = globalThis.fetch,
  now = Date.now,
}) {
  const read = (key) => {
    try {
      return JSON.parse(storage.getItem(key));
    } catch {
      return null;
    }
  };
  // Earlier tabs can keep their media key while dialogue uses the server.
  const connection = () => {
    const value = read(CONNECTION);
    return value ? { ...value, chat: false } : null;
  };
  async function request(
    path,
    { body, signal, raw = false, key = connection()?.key } = {},
  ) {
    const response = await fetcher(new URL(path, API), {
      method: body === undefined ? "GET" : "POST",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        "X-OpenRouter-Title": "Lonely Forest",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal || AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      const policy = /data policy|data retention|privacy/i.test(
        detail?.error?.message || "",
      );
      const message =
        response.status === 402
          ? "Add credits in OpenRouter, then try again."
          : response.status === 401 || response.status === 403
            ? "Connect OpenRouter again in Settings."
            : response.status === 404
              ? policy
                ? "Check your OpenRouter privacy settings for an available model provider."
                : "OpenRouter needs an available provider for this model."
              : response.status === 400 || response.status === 422
                ? "Check the model settings in OpenRouter, then try again."
                : `OpenRouter needs another moment (${response.status}). Try again.`;
      // Show OpenRouter's own words for request and provider failures.
      const reason =
        response.status === 400 ||
        response.status === 422 ||
        response.status >= 500
          ? errorText(detail?.error?.message)
          : "";
      throw Object.assign(
        new Error(reason ? `${message} ${reason}` : message),
        {
          status: response.status,
          retryable:
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500,
        },
      );
    }
    return raw ? response.blob() : response.json();
  }
  return {
    connection,
    async begin(href, { popup = false, accept = () => true } = {}) {
      const callback = new URL(href);
      for (const key of [
        "code",
        "state",
        "error",
        "error_description",
        "openrouter",
      ])
        callback.searchParams.delete(key);
      const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
      const state = encode(crypto.getRandomValues(new Uint8Array(32)));
      if (popup) {
        callback.pathname = "/card-game/openrouter-callback.html";
        callback.search = "";
        callback.hash = "";
      }
      callback.searchParams.set("openrouter", "callback");
      // OpenRouter preserves the callback query when it appends the code.
      callback.searchParams.set("state", state);
      const challenge = encode(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        ),
      );
      if (!accept()) return null;
      storage.setItem(
        PENDING,
        JSON.stringify({ verifier, state, at: now(), callback: callback.href }),
      );
      const url = new URL("https://openrouter.ai/auth");
      for (const [key, value] of Object.entries({
        callback_url: callback.href,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        key_label: "CosyWorld",
      }))
        url.searchParams.set(key, value);
      return url.href;
    },
    async finish(href, cleanUrl, { accept = () => true } = {}) {
      const url = new URL(href);
      const pending = read(PENDING);
      const response =
        url.searchParams.has("code") || url.searchParams.has("error");
      const popupReturn =
        url.pathname === "/card-game/openrouter-callback.html" && response;
      if (
        url.searchParams.get("openrouter") !== "callback" &&
        !popupReturn &&
        !(pending && response)
      )
        return false;
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const denied = url.searchParams.has("error");
      storage.removeItem(PENDING);
      for (const key of [
        "code",
        "state",
        "error",
        "error_description",
        "openrouter",
      ])
        url.searchParams.delete(key);
      cleanUrl(url.href);
      if (denied) throw new Error("Connect OpenRouter when you are ready.");
      if (
        !pending ||
        !code ||
        state !== pending.state ||
        now() - pending.at > 600_000 ||
        now() < pending.at
      )
        throw new Error("Start a fresh OpenRouter connection in Settings.");
      const expected = new URL(pending.callback);
      expected.searchParams.delete("openrouter");
      expected.searchParams.delete("state");
      if (expected.href !== url.href) {
        // Restore game parameters if the provider replaces the callback query.
        if (
          url.origin !== expected.origin ||
          url.pathname !== expected.pathname ||
          url.hash !== expected.hash ||
          url.search !== ""
        )
          throw new Error(
            "Return to the table where you started the connection.",
          );
        cleanUrl(expected.href);
      }
      const result = await request("auth/keys", {
        key: "",
        body: {
          code,
          code_verifier: pending.verifier,
          code_challenge_method: "S256",
        },
      });
      if (!/^sk-or-[\x21-\x7e]{14,506}$/u.test(result.key || ""))
        throw new Error("Start a fresh OpenRouter connection in Settings.");
      if (!accept()) return false;
      storage.setItem(CONNECTION, JSON.stringify({ key: result.key }));
      return true;
    },
    // Keep these methods available to tabs opened before server dialogue.
    setChat() {
      const value = connection();
      if (value)
        storage.setItem(CONNECTION, JSON.stringify({ ...value, chat: false }));
    },
    setVideoModel(videoModel) {
      const value = connection();
      if (value)
        storage.setItem(CONNECTION, JSON.stringify({ ...value, videoModel }));
    },
    disconnect() {
      storage.removeItem(CONNECTION);
      storage.removeItem(PENDING);
    },
    headers() {
      return {};
    },
    request,
    async speech(model, voice, input, signal) {
      return request("audio/speech", {
        body: { model, voice, input, response_format: "mp3" },
        signal,
        raw: true,
      });
    },
    async video(model, prompt, signal, progress = () => {}, options = {}) {
      const {
        duration,
        resolution,
        aspect_ratio,
        generate_audio,
        frame_images,
      } = options;
      const key = connection()?.key;
      let job = await request("videos", {
        key,
        body: {
          model,
          prompt,
          ...(duration === undefined ? {} : { duration }),
          ...(resolution ? { resolution } : {}),
          ...(aspect_ratio ? { aspect_ratio } : {}),
          ...(generate_audio === undefined ? {} : { generate_audio }),
          ...(frame_images?.length ? { frame_images } : {}),
        },
        signal,
      });
      if (typeof job.id !== "string" || !job.id || job.id.length > 200)
        throw new Error("OpenRouter needs a fresh video request.");
      const path = `videos/${encodeURIComponent(job.id)}`;
      const deadline = now() + 15 * 60_000;
      while (job.status !== "completed") {
        if (["failed", "cancelled", "expired"].includes(job.status)) {
          const reason = errorText(job.error?.message ?? job.error);
          throw new Error(
            `The video needs a fresh request (${job.status}). ${reason || "Check OpenRouter activity."}`,
          );
        }
        if (now() > deadline)
          throw new Error(
            "Your video is still processing. Check OpenRouter activity.",
          );
        progress("Your video is being made…");
        await new Promise((resolve, reject) => {
          signal?.throwIfAborted();
          const stop = () => {
            clearTimeout(timer);
            reject(signal.reason);
          };
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", stop);
            resolve();
          }, 3000);
          signal?.addEventListener("abort", stop, { once: true });
        });
        job = await request(path, { signal, key });
      }
      // Construct the fixed OpenRouter content path so credentials stay there.
      return request(`${path}/content?index=0`, { signal, key, raw: true });
    },
  };
}

let client;
export function playerOpenRouter() {
  if (!client) {
    let storage;
    try {
      storage = globalThis.sessionStorage;
    } catch {
      /* Settings explains storage access. */
    }
    client = createOpenRouter({ storage });
  }
  return client;
}
