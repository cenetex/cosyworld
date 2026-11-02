#!/usr/bin/env node
// The `.dev` agent test passkey. `.dev` runs members-only
// (`COSYWORLD_PASSKEYS=members`), so agents and CI smokes sign in as the
// dedicated `agent-test` account through a Chrome virtual authenticator.
//
//   node v2/scripts/dev-test-passkey.mjs generate [--force]
//     Writes a new key pair to ~/.config/cosyworld/dev-test-passkey.json
//     (mode 600) and prints the owner's fly and gh commands.
//   node v2/scripts/dev-test-passkey.mjs check [https://cosyworld.fly.dev]
//     Signs in with a headless browser and checks a members-only endpoint.
//
// In a Playwright script:
//   import { devPasskeySession } from "./dev-test-passkey.mjs";
//   await devPasskeySession(page); // page is now signed in as agent-test
//
// The secret comes from COSYWORLD_DEV_TEST_PASSKEY_SECRET (the JSON itself,
// as in CI), else COSYWORLD_DEV_TEST_PASSKEY_FILE, else the default file.
// The server holds only the public half (COSYWORLD_DEV_TEST_PASSKEY).
import { webcrypto } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEV_URL = "https://cosyworld.fly.dev";
export const DEFAULT_SECRET_FILE = join(
  homedir(),
  ".config",
  "cosyworld",
  "dev-test-passkey.json",
);
// Matches TEST_USER_ID in v2/orchestrator-rust/src/account_auth/dev_test_passkey.rs.
export const TEST_USER_ID = "0a9e17e5-7e57-4a11-8a6e-000000000001";
const COUNTER_EPOCH_MS = Date.UTC(2026, 0, 1);

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const uuidBytes = (uuid) => Buffer.from(uuid.replaceAll("-", ""), "hex");

export function loadDevTestPasskey() {
  const inline = process.env.COSYWORLD_DEV_TEST_PASSKEY_SECRET?.trim();
  const file =
    process.env.COSYWORLD_DEV_TEST_PASSKEY_FILE || DEFAULT_SECRET_FILE;
  const raw = inline || (existsSync(file) ? readFileSync(file, "utf8") : "");
  if (!raw)
    throw new Error(
      `No dev test passkey: set COSYWORLD_DEV_TEST_PASSKEY_SECRET or create ${file} ` +
        "(node v2/scripts/dev-test-passkey.mjs generate).",
    );
  const secret = JSON.parse(raw);
  for (const field of ["credentialId", "privateKey", "userHandle"])
    if (!secret[field])
      throw new Error(`dev test passkey secret lacks ${field}`);
  return secret;
}

// The server rejects a signature counter that does not move forward. Every
// run installs the credential afresh, so start from tenths of a second since
// 2026; the authenticator counts up from there within a run.
const freshSignCount = () =>
  Math.floor((Date.now() - COUNTER_EPOCH_MS) / 100) >>> 0;

/** Install the agent-test passkey in this page's browser and sign in. */
export async function devPasskeySession(
  page,
  {
    baseUrl = process.env.COSYWORLD_DEV_URL || DEV_URL,
    secret = loadDevTestPasskey(),
  } = {},
) {
  const origin = new URL(baseUrl).origin;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  await cdp.send("WebAuthn.addCredential", {
    authenticatorId,
    credential: {
      credentialId: secret.credentialId,
      isResidentCredential: true,
      rpId: new URL(origin).hostname,
      privateKey: secret.privateKey,
      userHandle: secret.userHandle,
      signCount: freshSignCount(),
    },
  });
  if (new URL(page.url() || "about:blank").origin !== origin)
    await page.goto(`${origin}/meta`);
  const identity = await page.evaluate(async () => {
    const { passkey } = await import("/card-game/shared-auth.mjs");
    return passkey(false);
  });
  if (!identity?.authenticated)
    throw new Error("dev test passkey sign-in failed");
  const cookies = await page.context().cookies(origin);
  const session = cookies.find((cookie) =>
    cookie.name.endsWith("cosyworld_session"),
  );
  return {
    identity,
    authenticatorId,
    cdp,
    cookie: session ? `${session.name}=${session.value}` : null,
  };
}

async function generate(force) {
  const file =
    process.env.COSYWORLD_DEV_TEST_PASSKEY_FILE || DEFAULT_SECRET_FILE;
  if (existsSync(file) && !force)
    throw new Error(
      `${file} exists; pass --force to replace it (this retires the old key).`,
    );
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  const pkcs8 = await webcrypto.subtle.exportKey("pkcs8", pair.privateKey);
  const credential = webcrypto.getRandomValues(new Uint8Array(32));
  const serverValue = JSON.stringify({
    credential_id: b64url(credential),
    x: jwk.x,
    y: jwk.y,
  });
  const secret = {
    account: "agent-test",
    rpId: "cosyworld.fly.dev",
    credentialId: b64(credential),
    privateKey: b64(pkcs8),
    userHandle: b64(uuidBytes(TEST_USER_ID)),
    server: serverValue,
    createdAt: new Date().toISOString(),
  };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(secret, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(`Wrote ${file} (mode 600). Finish setup with:\n`);
  console.log(
    `fly secrets set --app cosyworld COSYWORLD_DEV_TEST_PASSKEY='${serverValue}'`,
  );
  console.log(
    `gh secret set COSYWORLD_DEV_TEST_PASSKEY_SECRET --repo cenetex/cosyworld < ${file}`,
  );
  console.log(`node v2/scripts/dev-test-passkey.mjs check`);
}

async function check(baseUrl) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const { identity } = await devPasskeySession(page, { baseUrl });
    const status = await page.evaluate(
      async () =>
        (await fetch("/card-game/shared/worlds", { cache: "no-store" })).status,
    );
    console.log(
      `Signed in to ${baseUrl} as ${identity.username}; shared worlds -> ${status}`,
    );
    if (status === 401) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const run =
    command === "generate"
      ? generate(rest.includes("--force"))
      : command === "check"
        ? check(rest[0] || process.env.COSYWORLD_DEV_URL || DEV_URL)
        : Promise.reject(
            new Error(
              "usage: dev-test-passkey.mjs generate [--force] | check [url]",
            ),
          );
  run.catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
