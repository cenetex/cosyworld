#!/usr/bin/env node

// Copyright (c) 2019-2024 Cenetex Inc. Licensed under the MIT License.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import markdownIt from "markdown-it";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const parser = markdownIt({ html: true, linkify: true });
const external = (url) => /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(url);
const htmlPath = (file) => file.replace(/\.md$/, ".html");
const escape = (text) => parser.utils.escapeHtml(text);
const defaultFence = parser.renderer.rules.fence;
parser.renderer.rules.fence = (tokens, index, options, env, renderer) =>
  tokens[index].info.trim() === "mermaid"
    ? `<div class="mermaid">${escape(tokens[index].content)}</div>`
    : defaultFence(tokens, index, options, env, renderer);
const diagrams = '<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script><script>mermaid.initialize({startOnLoad:true,securityLevel:"strict"});</script>';

export async function currentDocuments(root = defaultRoot) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "docs/current-docs.json"), "utf8"),
  );
  if (
    !Array.isArray(manifest.current) ||
    !manifest.current.length ||
    new Set(manifest.current).size !== manifest.current.length ||
    typeof manifest.history !== "string" ||
    !manifest.history.startsWith("docs/archive/")
  ) {
    throw new Error(
      "The current reading list needs distinct pages and a history index.",
    );
  }
  for (const file of [...manifest.current, manifest.history]) {
    if (
      !file.endsWith(".md") ||
      path.isAbsolute(file) ||
      file.split("/").includes("..")
    ) {
      throw new Error(`Invalid documentation path: ${file}`);
    }
    await fs.access(path.join(root, file));
  }
  if (manifest.current.some((file) => file.startsWith("docs/archive/"))) {
    throw new Error("History pages belong in the separate History section.");
  }
  return manifest;
}

function attributes(tokens) {
  const result = [];
  for (const token of tokens) {
    for (const key of ["href", "src"]) {
      if (token.attrGet(key))
        result.push({ token, key, url: token.attrGet(key) });
    }
    if (token.children) result.push(...attributes(token.children));
  }
  return result;
}

export async function checkCurrentLinks(root = defaultRoot) {
  const manifest = await currentDocuments(root);
  const failures = [];
  for (const file of manifest.current) {
    const text = await fs.readFile(path.join(root, file), "utf8");
    for (const { url } of attributes(parser.parse(text, {}))) {
      if (external(url)) continue;
      const target = decodeURIComponent(url.split(/[?#]/)[0]);
      try {
        await fs.access(path.resolve(root, path.dirname(file), target));
      } catch {
        failures.push(`${file}: ${url}`);
      }
    }
  }
  if (failures.length)
    throw new Error(
      `Broken current documentation links:\n${failures.join("\n")}`,
    );
  return manifest;
}

async function markdownFiles(root, directory) {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, directory), {
    withFileTypes: true,
  })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(root, file)));
    else if (entry.isFile() && file.endsWith(".md")) files.push(file);
  }
  return files.sort();
}

export async function buildDocs(
  root = defaultRoot,
  output = path.join(root, "dist/docs"),
) {
  const manifest = await checkCurrentLinks(root);
  const pages = new Set([
    ...manifest.current,
    manifest.history,
    ...(await markdownFiles(root, "docs")),
    ...(await markdownFiles(root, "v2/docs")),
  ]);
  const texts = new Map();
  for (const file of pages)
    texts.set(file, await fs.readFile(path.join(root, file), "utf8"));
  const title = (file) =>
    texts
      .get(file)
      .split("\n")[0]
      .replace(/^#+\s*/, "");
  const relative = (from, to) =>
    path.relative(path.dirname(from), to).split(path.sep).join("/");
  const navigation = (file) =>
    `<nav><h2>Current game</h2><ul>${manifest.current
      .map(
        (target) =>
          `<li><a href="${escape(relative(htmlPath(file), htmlPath(target)))}">${escape(title(target))}</a></li>`,
      )
      .join(
        "",
      )}</ul><h2>History</h2><a href="${escape(relative(htmlPath(file), htmlPath(manifest.history)))}">Classic archive</a></nav>`;
  const page = (name, nav, body) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(name)} · CosyWorld</title><style>body{font:17px/1.6 system-ui;margin:2rem auto;max-width:1200px;display:flex;gap:3rem;padding:0 1rem}nav{min-width:220px;max-width:260px}main{min-width:0;flex:1}img{max-width:100%}pre{overflow:auto;padding:1rem;background:#f4f4f4}table{border-collapse:collapse}td,th{padding:.4rem;border:1px solid #ccc}@media(max-width:750px){body{display:block}nav{max-width:100%}}</style></head><body>${nav}<main>${body}</main></body></html>`;
  await fs.mkdir(output, { recursive: true });
  for (const file of pages) {
    const tokens = parser.parse(texts.get(file), {});
    for (const { token, key, url } of attributes(tokens)) {
      if (external(url)) continue;
      const [targetPart, fragment] = url.split("#", 2);
      const target = path.posix.normalize(
        path.posix.join(
          path.posix.dirname(file),
          decodeURIComponent(targetPart),
        ),
      );
      if (target.startsWith("../")) continue;
      if (pages.has(target)) {
        token.attrSet(
          key,
          relative(htmlPath(file), htmlPath(target)) +
            (fragment ? `#${fragment}` : ""),
        );
      } else if (key === "src") {
        try {
          const destination = path.join(output, target);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.copyFile(path.join(root, target), destination);
        } catch {
          /* Historical pages retain their source references. */
        }
      } else {
        token.attrSet(
          key,
          `https://github.com/cenetex/cosyworld/blob/main/${target}${fragment ? `#${fragment}` : ""}`,
        );
      }
    }
    // Stable heading anchors keep links within and between guides useful.
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === "heading_open") {
        const id = tokens[i + 1].content
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s_-]/gu, "")
          .replace(/\s/g, "-");
        tokens[i].attrSet("id", id);
      }
    }
    const destination = path.join(output, htmlPath(file));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(
      destination,
      page(
        title(file),
        navigation(file),
        parser.renderer.render(tokens, parser.options, {}) +
          (tokens.some((token) => token.type === "fence" && token.info.trim() === "mermaid") ? diagrams : ""),
      ),
    );
  }
  const combined =
    "# CosyWorld current game documentation\n\nSelected by docs/current-docs.json. Historical guides are in the separate classic archive.\n\n" +
    manifest.current
      .map((file) => `## Source: ${file}\n\n${texts.get(file)}`)
      .join("\n\n---\n\n");
  await fs.writeFile(path.join(output, "cosyworld-docs-combined.md"), combined);
  await fs.writeFile(
    path.join(output, "index.html"),
    page(
      "Documentation",
      navigation("index.md"),
      "<h1>CosyWorld documentation</h1><p>Choose a current guide from the reading list. Earlier guides are in History.</p>",
    ),
  );
  return { current: manifest.current.length, pages: pages.size, output };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.includes("--check")) {
    const manifest = await checkCurrentLinks();
    console.log(
      `Current documentation: ${manifest.current.length} pages, paths and links checked.`,
    );
  } else {
    console.log(await buildDocs());
  }
}
