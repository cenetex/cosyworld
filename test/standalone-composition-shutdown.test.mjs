import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stopServer } from "../v2/scripts/smoke-standalone-compositions.mjs";

const children = new Set();

async function startChild(onShutdown) {
  const child = spawn(process.execPath, ["-e", `
    process.on("SIGTERM", () => { ${onShutdown} });
    process.send("ready");
    setInterval(() => {}, 1000);
  `], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  children.add(child);
  await once(child, "message");
  return child;
}

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
  children.clear();
});

describe("standalone composition shutdown", () => {
  it("waits for a final checkpoint flushed after the runtime's default drain", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "cosy-smoke-shutdown-"));
    const checkpoint = resolve(directory, "checkpoint.txt");
    try {
      const child = await startChild(`
        setTimeout(() => {
          require("node:fs").writeFileSync(${JSON.stringify(checkpoint)}, "flushed");
          process.exit(0);
        }, 3000);
      `);
      await stopServer(child);
      expect(child.exitCode).toBe(0);
      expect(child.signalCode).toBeNull();
      expect(await readFile(checkpoint, "utf8")).toBe("flushed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a forced shutdown only after the child has exited", async () => {
    const child = await startChild("");
    await expect(stopServer(child, { timeoutMs: 50 })).rejects.toThrow(
      /exceeded 50ms.*SIGKILL.*checkpoint may be incomplete/,
    );
    expect(child.signalCode).toBe("SIGKILL");
  });

  it("rejects an unsuccessful graceful shutdown", async () => {
    const child = await startChild("process.exit(7);");
    await expect(stopServer(child)).rejects.toThrow(
      /code 7.*checkpoint may be incomplete/,
    );
    expect(child.exitCode).toBe(7);
  });

  it("accepts a child that already exited cleanly", async () => {
    const child = await startChild("process.exit(0);");
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
    await expect(stopServer(child)).resolves.toBeUndefined();
  });
});
