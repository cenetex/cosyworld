import assert from "node:assert/strict";
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

test("failed smoke requests name the method, Host, path, and transport without retrying a POST", async () => {
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
        "/avatar",
        { method: "POST", body: { name: "Smoke" } },
        new URL(`http://127.0.0.1:${port}`),
      ),
      /POST host=lantern\.lonelyforest\.com path=\/avatar connect=127\.0\.0\.1:/,
    );
    assert.equal(attempts, 1, "a mutating smoke request must not receive a blind transport retry");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
