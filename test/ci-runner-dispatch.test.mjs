import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createDispatcher, verifySignature, wantsFlyRunner } from "../infra/ci-runners/dispatch/server.mjs";

const REPO = "cenetex/cosyworld";
const FLY_JOB = { id: 7, run_id: 70, labels: ["self-hosted", "fly", "cosyworld"] };

function fakeApis({ headRepo = REPO, machines = [{ id: "m1", state: "stopped", config: { env: { A: "1" } } }] } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? "GET", body: options.body });
    let body = {};
    if (url.endsWith(`/actions/runs/${FLY_JOB.run_id}`)) body = { head_repository: { full_name: headRepo } };
    else if (url.endsWith("/generate-jitconfig")) body = { encoded_jit_config: "jit-123" };
    else if (url.endsWith("/machines")) body = machines;
    else if (url.endsWith("/lease") && options.method === "POST") body = { data: { nonce: "n1" } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, fetchImpl };
}

describe("CI runner dispatch", () => {
  it("accepts only GitHub's signature for the exact body", () => {
    const body = Buffer.from('{"a":1}');
    const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    expect(verifySignature("s3cret", body, sig)).toBe(true);
    expect(verifySignature("s3cret", Buffer.from('{"a":2}'), sig)).toBe(false);
    expect(verifySignature("", body, sig)).toBe(false);
  });

  it("matches only jobs asking for every Fly label", () => {
    expect(wantsFlyRunner(FLY_JOB)).toBe(true);
    expect(wantsFlyRunner({ labels: ["ubuntu-latest"] })).toBe(false);
    expect(wantsFlyRunner({ labels: ["self-hosted", "fly"] })).toBe(false);
  });

  it("starts a stopped machine with a fresh just-in-time config", async () => {
    const { calls, fetchImpl } = fakeApis();
    const dispatcher = createDispatcher({ GITHUB_TOKEN: "t", FLY_API_TOKEN: "f" }, fetchImpl);
    expect(await dispatcher.handle("workflow_job", { action: "queued", workflow_job: FLY_JOB })).toBe("ok");
    const update = calls.find((c) => c.url.endsWith("/machines/m1") && c.method === "POST");
    expect(JSON.parse(update.body).config.env).toEqual({ A: "1", RUNNER_JITCONFIG: "jit-123" });
    expect(calls.some((c) => c.url.endsWith("/machines/m1/start"))).toBe(true);
    expect(dispatcher.state()).toEqual({ waiting: 1, starting: 1 });
    await dispatcher.handle("workflow_job", { action: "in_progress", workflow_job: FLY_JOB });
    expect(dispatcher.state()).toEqual({ waiting: 0, starting: 0 });
  });

  it("refuses jobs from fork runs before minting a runner", async () => {
    const { calls, fetchImpl } = fakeApis({ headRepo: "someone/cosyworld" });
    const dispatcher = createDispatcher({ GITHUB_TOKEN: "t", FLY_API_TOKEN: "f" }, fetchImpl);
    expect(await dispatcher.handle("workflow_job", { action: "queued", workflow_job: FLY_JOB })).toBe("refused");
    expect(calls.some((c) => c.url.includes("generate-jitconfig") || c.url.includes("machines.dev"))).toBe(false);
  });

  it("keeps the job waiting when every machine is busy", async () => {
    const { fetchImpl } = fakeApis({ machines: [{ id: "m1", state: "started", config: {} }] });
    const dispatcher = createDispatcher({ GITHUB_TOKEN: "t", FLY_API_TOKEN: "f" }, fetchImpl);
    await dispatcher.handle("workflow_job", { action: "queued", workflow_job: FLY_JOB });
    expect(dispatcher.state()).toEqual({ waiting: 1, starting: 0 });
  });
});
