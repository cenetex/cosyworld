#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const shellPath = resolve(__dirname, "../orchestrator-rust/src/index.html");
const html = await readFile(shellPath, "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];

assert.equal(scripts.length, 1, `expected one inline browser script in ${shellPath}`);
new Script(scripts[0][1], { filename: shellPath });
