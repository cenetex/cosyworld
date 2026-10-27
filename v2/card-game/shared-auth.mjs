import { playerOpenRouter } from "./openrouter.mjs";
const decode = (value) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
const encode = (value) =>
  btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export async function request(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(body &&
      ["play", "retry"].includes(body.op) &&
      path.startsWith("/card-game/shared/worlds/")
        ? playerOpenRouter().headers()
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || result.error)
    throw new Error(result.error || "The world is taking a moment. Try again.");
  return result;
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
