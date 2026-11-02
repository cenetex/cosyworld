const decode = (value) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
const encode = (value) =>
  btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export async function request(path, body, headers = {}) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || result.error)
    // No cause: a cause marks a play whose fate is uncertain (app.mjs).
    throw new Error(
      playerText(result.error) || "The world is taking a moment. Try again.",
    );
  return result;
}
// A shared world belongs to everyone in it, so a rules refusal to load it
// reads as a world waiting for an update, never a local fresh start.
export const WORLD_UPDATE =
  "This world is waiting for an update. Everything in it is kept. Try again soon.";
// The server names where the rules refused a save ("validateWorld:7217 <
// ..."). That trace is for the console; the player reads one sentence.
export function playerText(message) {
  if (typeof message !== "string" || !message) return message;
  const trace = /\s*\((?:[\w$.]+:\d+)(?: < [\w$.]+:\d+)*\)$/u;
  if (trace.test(message)) console.warn(`Shared rules refusal: ${message}`);
  const text = message.replace(trace, "");
  return /fresh start|New game/u.test(text) ? WORLD_UPDATE : text;
}
export async function passkey(register = false) {
  if (!window.PublicKeyCredential || !navigator.credentials)
    throw new Error("Open this page in a browser with passkey support.");
  const mode = register ? "register" : "login";
  const start = await request(`/auth/passkey/${mode}/start`, {});
  const options = start.public_key.publicKey || start.public_key;
  options.challenge = decode(options.challenge);
  if (register) {
    options.user.id = decode(options.user.id);
    options.excludeCredentials = (options.excludeCredentials || []).map(
      (c) => ({ ...c, id: decode(c.id) }),
    );
  } else {
    options.allowCredentials = (options.allowCredentials || []).map((c) => ({
      ...c,
      id: decode(c.id),
    }));
  }
  const credential = await navigator.credentials[register ? "create" : "get"]({
    publicKey: options,
  });
  if (!credential) throw new Error("Choose a passkey to continue.");
  const r = credential.response;
  const serialized =
    typeof credential.toJSON === "function"
      ? credential.toJSON()
      : {
          id: credential.id,
          rawId: encode(credential.rawId),
          type: credential.type,
          clientExtensionResults: credential.getClientExtensionResults(),
          response: register
            ? {
                attestationObject: encode(r.attestationObject),
                clientDataJSON: encode(r.clientDataJSON),
                transports: r.getTransports?.() || [],
              }
            : {
                authenticatorData: encode(r.authenticatorData),
                clientDataJSON: encode(r.clientDataJSON),
                signature: encode(r.signature),
                userHandle: r.userHandle ? encode(r.userHandle) : null,
              },
        };
  return request(`/auth/passkey/${mode}/finish`, {
    ceremony_id: start.ceremony_id,
    credential: serialized,
  });
}
// A members-only server (`COSYWORLD_PASSKEYS=members`, the .dev test server)
// takes no new passkeys and no signed-out play. Until a known passkey signs
// in, the table shows only this lock. Without the account API (a static or
// local table) play starts as usual.
export async function membersLock() {
  let account;
  try {
    account = await request("/auth/account");
  } catch {
    return false;
  }
  if (!account.members_only || account.authenticated) return false;
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "/card-game/shared.css";
  document.head.append(style);
  const lock = document.createElement("dialog");
  lock.id = "members-lock";
  lock.className = "shared-lobby";
  lock.oncancel = (event) => event.preventDefault();
  const heading = document.createElement("h2");
  heading.textContent = "Invited players only";
  const text = document.createElement("p");
  text.textContent =
    "This test server is for invited players. Sign in with your passkey.";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const signIn = document.createElement("button");
  signIn.type = "button";
  signIn.textContent = "Sign in with your passkey";
  signIn.onclick = async () => {
    signIn.disabled = true;
    status.textContent = "";
    try {
      await passkey(false);
      location.reload();
    } catch (error) {
      status.textContent =
        error.name === "NotAllowedError"
          ? "The passkey step was closed. You can try again."
          : error.message;
      signIn.disabled = false;
    }
  };
  const elsewhere = document.createElement("p");
  const link = document.createElement("a");
  link.href = "https://lonelyforest.com";
  link.textContent = "Play at lonelyforest.com";
  elsewhere.append(link);
  lock.append(heading, text, signIn, status, elsewhere);
  document.body.append(lock);
  document.body.inert = false;
  lock.showModal();
  return true;
}
