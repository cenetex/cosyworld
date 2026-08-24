import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";

import { request, requestContext, requestTarget } from "./smoke-lonelyforest-multitenant.mjs";

test("remote Lonely Forest tenant smokes connect and negotiate TLS with the tenant hostname", () => {
  const target = requestTarget(new URL("https://lonelyforest.com"), "7.lonelyforest.com");
  assert.deepEqual(target, {
    hostname: "7.lonelyforest.com",
    port: undefined,
    hostHeader: "7.lonelyforest.com",
    servername: "7.lonelyforest.com",
  });
  assert.match(
    requestContext({ method: "GET", host: "7.lonelyforest.com", path: "/meta", target }),
    /GET host=7\.lonelyforest\.com path=\/meta connect=7\.lonelyforest\.com/,
  );
});

test("an explicit shared transport keeps the tenant Host while using Fly DNS and TLS", () => {
  const target = requestTarget(
    new URL("https://cosyworld-lonelyforest.fly.dev"),
    "0.lonelyforest.com",
    { sharedTransport: true },
  );
  assert.deepEqual(target, {
    hostname: "cosyworld-lonelyforest.fly.dev",
    port: undefined,
    hostHeader: "0.lonelyforest.com",
    servername: "cosyworld-lonelyforest.fly.dev",
  });
});

test("loopback Lonely Forest router smokes retain one transport target and vary Host", () => {
  const target = requestTarget(new URL("http://127.0.0.1:3000"), "lantern.lonelyforest.com");
  assert.deepEqual(target, {
    hostname: "127.0.0.1",
    port: "3000",
    hostHeader: "lantern.lonelyforest.com",
    servername: undefined,
  });
});

test("remote unknown-host router probes retain the configured public transport", () => {
  const target = requestTarget(
    new URL("https://lonelyforest.com"),
    "untrusted.lonelyforest.com",
    { routerProbe: true },
  );
  assert.deepEqual(target, {
    hostname: "lonelyforest.com",
    port: undefined,
    hostHeader: "untrusted.lonelyforest.com",
    servername: "lonelyforest.com",
  });
});

test("failed smoke requests name the method, Host, path, and transport", async () => {
  let attempts = 0;
  const server = http.createServer((incoming) => {
    attempts += 1;
    incoming.socket.destroy();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await assert.rejects(
      request(
        "lantern.lonelyforest.com",
        "/meta",
        {},
        new URL(`http://127.0.0.1:${port}`),
      ),
      /GET host=lantern\.lonelyforest\.com path=\/meta connect=127\.0\.0\.1:/,
    );
    assert.equal(attempts, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("the deployed multitenant smoke is read-only", () => {
  const source = fs.readFileSync(new URL("./smoke-lonelyforest-multitenant.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /method:\s*["']POST["']/);
  assert.doesNotMatch(source, /["']\/avatar["']/);
});
