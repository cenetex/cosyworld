import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const bookDir = path.join(rootDir, "docs", "dm-guide");
const outputDir = path.join(rootDir, "dist", "publications", "dm-guide");
const manifest = JSON.parse(
  fs.readFileSync(path.join(bookDir, "manifest.json"), "utf8"),
);
const pdfPath = path.join(outputDir, "cosyworld-referee-guide.pdf");
const epubPath = path.join(outputDir, "cosyworld-referee-guide.epub");
const htmlPath = path.join(outputDir, "cosyworld-referee-guide.html");
const epubCoverPath = path.join(outputDir, "cosyworld-referee-guide-cover.jpg");
const buildManifestPath = path.join(outputDir, "build-manifest.json");
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function available(command, args = ["--version"]) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

function requireCommand(command, args = ["--version"]) {
  check(
    available(command, args),
    `missing required publication validator: ${command}`,
  );
}

function run(command, args) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

function hashFile(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function walkFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
    })
    .sort();
}

for (const [command, args] of [
  ["qpdf", ["--version"]],
  ["pdfinfo", ["-v"]],
  ["pdffonts", ["-v"]],
  ["pdftotext", ["-v"]],
  ["epubcheck", ["--version"]],
  ["unzip", ["-v"]],
]) {
  requireCommand(command, args);
}

const sources = manifest.chapters.map((entry) => {
  const filePath = path.join(bookDir, entry);
  check(fs.existsSync(filePath), `missing source ${entry}`);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
});
const manuscript = sources.join("\n");

check(!/[‐‑‒–—―]/u.test(manuscript), "manuscript contains a non-ASCII dash");
check(!/!\[[\t ]*\]\(/u.test(manuscript), "an image has empty alt text");
check(
  !/\]\((?:\.\.\/|\.\/)?[^)#\s]+\.md(?:#[^)]+)?\)/u.test(manuscript),
  "manuscript links to a Markdown source file instead of an internal anchor",
);
check(
  !/!\[[^\]]+\]\(https?:\/\//u.test(manuscript),
  "manuscript contains a remote image",
);

const imageReferences = [
  ...manuscript.matchAll(/!\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu),
].map((match) => match[1]);
for (const reference of imageReferences) {
  const filePath = path.resolve(bookDir, reference);
  check(
    filePath.startsWith(`${bookDir}${path.sep}`),
    `image path leaves the publication directory: ${reference}`,
  );
  check(fs.existsSync(filePath), `missing image asset: ${reference}`);
}

const explicitIds = [...manuscript.matchAll(/\{#([a-z0-9][a-z0-9-]*)\}/gu)].map(
  (match) => match[1],
);
const duplicateIds = explicitIds.filter(
  (id, index) => explicitIds.indexOf(id) !== index,
);
check(
  duplicateIds.length === 0,
  `duplicate explicit ids: ${[...new Set(duplicateIds)].join(", ")}`,
);

const listedChapters = new Set(
  manifest.chapters.map((entry) => path.normalize(entry)),
);
const chapterDirectory = path.join(bookDir, "chapters");
for (const entry of fs.readdirSync(chapterDirectory)) {
  if (!entry.endsWith(".md")) continue;
  const relative = path.join("chapters", entry);
  check(listedChapters.has(relative), `unlisted chapter source: ${relative}`);
}

for (const output of [
  htmlPath,
  pdfPath,
  epubPath,
  epubCoverPath,
  buildManifestPath,
]) {
  check(
    fs.existsSync(output),
    `missing build output ${path.relative(rootDir, output)}`,
  );
  if (fs.existsSync(output)) {
    const minimumBytes = output === buildManifestPath ? 500 : 10_000;
    check(
      fs.statSync(output).size > minimumBytes,
      `build output is unexpectedly small: ${output}`,
    );
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, "utf8"));
check(buildManifest.schemaVersion === 1, "invalid build manifest schema");
for (const [relative, expectedHash] of Object.entries(
  buildManifest.inputs ?? {},
)) {
  const filePath = path.resolve(rootDir, relative);
  check(
    filePath === rootDir || filePath.startsWith(`${rootDir}${path.sep}`),
    `build input path leaves the repository: ${relative}`,
  );
  check(fs.existsSync(filePath), `build input is missing: ${relative}`);
  if (fs.existsSync(filePath)) {
    check(
      hashFile(filePath) === expectedHash,
      `build output is stale for input: ${relative}`,
    );
  }
}
for (const [relative, expected] of Object.entries(
  buildManifest.outputs ?? {},
)) {
  const filePath = path.resolve(outputDir, relative);
  check(
    filePath.startsWith(`${outputDir}${path.sep}`),
    `build output path leaves the publication directory: ${relative}`,
  );
  check(
    fs.existsSync(filePath),
    `recorded build output is missing: ${relative}`,
  );
  if (fs.existsSync(filePath)) {
    check(
      fs.statSync(filePath).size === expected.bytes,
      `recorded byte size differs for output: ${relative}`,
    );
    check(
      hashFile(filePath) === expected.sha256,
      `recorded hash differs for output: ${relative}`,
    );
  }
}

const generatedHtml = fs.readFileSync(htmlPath, "utf8");
const generatedIds = [...generatedHtml.matchAll(/\sid="([^"]+)"/gu)].map(
  (match) => match[1],
);
const duplicateGeneratedIds = generatedIds.filter(
  (id, index) => generatedIds.indexOf(id) !== index,
);
check(
  duplicateGeneratedIds.length === 0,
  `duplicate generated HTML ids: ${[...new Set(duplicateGeneratedIds)].join(
    ", ",
  )}`,
);
const generatedIdSet = new Set(generatedIds);
for (const match of generatedHtml.matchAll(/\shref="#([^"]+)"/gu)) {
  check(
    generatedIdSet.has(match[1]),
    `generated HTML contains an unresolved anchor: #${match[1]}`,
  );
}
for (const match of generatedHtml.matchAll(/<img\b([^>]*)>/gu)) {
  check(
    /\salt="[^"]+"/u.test(match[1]),
    "generated HTML image has no alt text",
  );
}
check(
  !/<(?:img|script|link)\b[^>]+(?:src|href)="https?:/iu.test(generatedHtml),
  "generated HTML loads a remote resource",
);

run("qpdf", ["--check", pdfPath]);
const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
check(/Tagged:\s+yes/i.test(info), "PDF is not tagged");
check(/Pages:\s+[1-9][0-9]*/i.test(info), "PDF has no pages");
check(/Page size:.*\(A5\)/i.test(info), "PDF is not A5");

const fonts = execFileSync("pdffonts", [pdfPath], { encoding: "utf8" });
const rows = fonts
  .split("\n")
  .slice(2)
  .filter((line) => line.trim());
check(rows.length > 0, "PDF contains no inspectable fonts");
check(
  rows.every((row) => {
    const columns = row.match(
      /\s+(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/i,
    );
    return columns?.[1].toLowerCase() === "yes";
  }),
  "one or more PDF fonts are not embedded",
);

const text = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
for (const phrase of [
  "The CosyWorld",
  "The Strict, Generous Referee",
  "19. Anchors, Forays, and Cairns",
  "The AI Referee",
]) {
  check(text.includes(phrase), `PDF text is missing "${phrase}"`);
}

run("epubcheck", [epubPath]);
run("unzip", ["-t", epubPath]);

const epubExtractDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "cosyworld-dm-guide-epub-"),
);
try {
  run("unzip", ["-q", epubPath, "-d", epubExtractDirectory]);
  const epubTextDirectory = path.join(epubExtractDirectory, "EPUB", "text");
  const epubXhtmlFiles = walkFiles(epubTextDirectory).filter((filePath) =>
    filePath.endsWith(".xhtml"),
  );
  const epubFileNames = epubXhtmlFiles.map((filePath) =>
    path.basename(filePath),
  );
  for (const required of ["cover.xhtml", "title_page.xhtml"]) {
    check(
      epubFileNames.filter((name) => name === required).length === 1,
      `EPUB must contain exactly one ${required}`,
    );
  }
  check(
    fs.existsSync(path.join(epubExtractDirectory, "EPUB", "nav.xhtml")),
    "EPUB is missing its navigation document",
  );
  for (const filePath of epubXhtmlFiles.filter((candidate) =>
    path.basename(candidate).startsWith("ch"),
  )) {
    const source = fs.readFileSync(filePath, "utf8");
    const visibleText = source
      .replace(/<style\b[\s\S]*?<\/style>/giu, "")
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    check(
      visibleText.length > 0 || /<img\b/iu.test(source),
      `EPUB contains an empty chapter: ${path.basename(filePath)}`,
    );
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 360, height: 640 },
    });
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (
        url.startsWith("file:") ||
        url.startsWith("data:") ||
        url.startsWith("about:")
      ) {
        await route.continue();
        return;
      }
      await route.abort("blockedbyclient");
    });
    for (const filePath of epubXhtmlFiles) {
      await page.goto(pathToFileURL(filePath).href, { waitUntil: "load" });
      await page.addStyleTag({
        content: "html { font-size: 200% !important; }",
      });
      const viewport = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      check(
        viewport.scrollWidth <= viewport.clientWidth + 1,
        `EPUB overflows at phone width and 200% text: ${path.basename(filePath)}`,
      );
    }
  } finally {
    await browser.close();
  }
} finally {
  fs.rmSync(epubExtractDirectory, { recursive: true, force: true });
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

for (const [tool, version] of Object.entries(buildManifest.tools ?? {})) {
  if (!version) {
    check(false, `build manifest is missing the ${tool} version`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("dm-guide check: publication source and artifacts are valid");
