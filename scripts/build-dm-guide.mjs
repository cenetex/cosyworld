import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const bookDir = path.join(rootDir, "docs", "dm-guide");
const outputDir = path.join(rootDir, "dist", "publications", "dm-guide");
const manifestPath = path.join(bookDir, "manifest.json");
const metadataPath = path.join(bookDir, "metadata.yaml");
const printCssPath = path.join(bookDir, "styles", "print.css");
const epubCssPath = path.join(bookDir, "styles", "epub.css");
const epubFilterPath = path.join(bookDir, "filters", "epub.lua");
const coverPath = path.join(bookDir, "assets", "illustrations", "cover.jpg");
const htmlPath = path.join(outputDir, "cosyworld-referee-guide.html");
const pdfPath = path.join(outputDir, "cosyworld-referee-guide.pdf");
const epubPath = path.join(outputDir, "cosyworld-referee-guide.epub");
const epubCoverPath = path.join(outputDir, "cosyworld-referee-guide-cover.jpg");
const buildManifestPath = path.join(outputDir, "build-manifest.json");

function fail(message) {
  console.error(`dm-guide build: ${message}`);
  process.exit(1);
}

function requireCommand(command, hint) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
  } catch {
    fail(`missing ${command}. ${hint}`);
  }
}

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd: bookDir,
    stdio: "inherit",
    ...options,
  });
}

function commandVersion(command, args = ["--version"]) {
  return execFileSync(command, args, { encoding: "utf8" })
    .split(/\r?\n/u)[0]
    .trim();
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

requireCommand("pandoc", "Install Pandoc 3.8 or newer.");
const pandocVersion = commandVersion("pandoc");
const pandocVersionMatch = pandocVersion.match(/^pandoc\s+(\d+)\.(\d+)/u);
if (
  !pandocVersionMatch ||
  Number(pandocVersionMatch[1]) < 3 ||
  (Number(pandocVersionMatch[1]) === 3 && Number(pandocVersionMatch[2]) < 8)
) {
  fail(`Pandoc 3.8 or newer is required; found "${pandocVersion}"`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.chapters)) {
  fail(
    "manifest.json must contain schemaVersion 1 and an ordered chapters array",
  );
}

const chapterPaths = manifest.chapters.map((entry) => {
  const absolute = path.resolve(bookDir, entry);
  if (!absolute.startsWith(`${bookDir}${path.sep}`)) {
    fail(`chapter path leaves the publication directory: ${entry}`);
  }
  if (!fs.existsSync(absolute)) {
    fail(`missing chapter ${entry}`);
  }
  return entry;
});
if (new Set(chapterPaths).size !== chapterPaths.length) {
  fail("manifest.json contains a duplicate chapter");
}

for (const required of [
  metadataPath,
  printCssPath,
  epubCssPath,
  epubFilterPath,
  coverPath,
]) {
  if (!fs.existsSync(required)) {
    fail(`missing publication input ${path.relative(rootDir, required)}`);
  }
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const commonPandocArgs = [
  ...chapterPaths,
  "--from=markdown+fenced_divs+link_attributes",
  "--standalone",
  "--fail-if-warnings",
  "--toc",
  "--toc-depth=2",
  `--metadata-file=${metadataPath}`,
  "--resource-path=.",
];

run("pandoc", [
  ...commonPandocArgs,
  "--to=html5",
  "--section-divs",
  "--embed-resources",
  `--css=${printCssPath}`,
  `--output=${htmlPath}`,
]);

const generatedHtml = fs.readFileSync(htmlPath, "utf8");
const titleBlockPattern =
  /<header id="title-block-header">[\s\S]*?<\/header>\s*/u;
const tocPattern = /<nav id="TOC" role="doc-toc">[\s\S]*?<\/nav>\s*/u;
const coverPattern = /<div class="cover-page">[\s\S]*?<\/div>/u;
const tocMatch = generatedHtml.match(tocPattern);
const coverMatch = generatedHtml.match(coverPattern);
if (!tocMatch || !coverMatch) {
  fail("generated HTML is missing the cover or table of contents");
}
const publicationHtml = generatedHtml
  .replace(titleBlockPattern, "")
  .replace(tocPattern, "")
  .replace(coverPattern, `${coverMatch[0]}\n${tocMatch[0]}`);
fs.writeFileSync(htmlPath, publicationHtml);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  fail(
    "Playwright is not installed. Run npm ci, then npx playwright install chromium.",
  );
}

const browser = await chromium.launch({ headless: true });
let chromiumVersion;
try {
  chromiumVersion = browser.version();
  const coverPage = await browser.newPage({
    viewport: { width: 1200, height: 1800 },
  });
  const coverData = fs.readFileSync(coverPath).toString("base64");
  await coverPage.setContent(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body {
        align-items: center;
        background: #f4efe3;
        display: flex;
        justify-content: center;
        overflow: hidden;
        position: relative;
      }
      img {
        height: 100%;
        object-fit: cover;
        width: 100%;
      }
      .title {
        background: rgba(244, 239, 227, 0.95);
        border: 3px solid #c8bda8;
        border-radius: 18px;
        bottom: 105px;
        color: #211c15;
        left: 90px;
        padding: 45px 55px;
        position: absolute;
        right: 90px;
        text-align: center;
      }
      h1 {
        font: 600 70px/1.05 Georgia, "Times New Roman", serif;
        margin: 0 0 20px;
      }
      p {
        color: #795533;
        font: 34px/1.25 Georgia, "Times New Roman", serif;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <img alt="" src="data:image/jpeg;base64,${coverData}">
    <div class="title">
      <h1>The CosyWorld Referee's Guide</h1>
      <p>A dungeon master's guide to a shared, remembered world</p>
    </div>
  </body>
</html>`,
    { waitUntil: "load" },
  );
  await coverPage.screenshot({
    path: epubCoverPath,
    type: "jpeg",
    quality: 94,
    fullPage: true,
  });
  await coverPage.close();

  run("pandoc", [
    ...commonPandocArgs,
    "--to=epub3",
    `--css=${epubCssPath}`,
    `--lua-filter=${epubFilterPath}`,
    `--epub-cover-image=${epubCoverPath}`,
    `--output=${epubPath}`,
  ]);

  const page = await browser.newPage();
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
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.evaluate(async () => {
    // eslint-disable-next-line no-undef -- This callback runs in the browser page.
    await document.fonts.ready;
    await Promise.all(
      // eslint-disable-next-line no-undef -- This callback runs in the browser page.
      [...document.images].map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise((resolve, reject) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", reject, { once: true });
            }),
      ),
    );
  });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: pdfPath,
    format: "A5",
    printBackground: true,
    preferCSSPageSize: true,
    tagged: true,
    outline: true,
    margin: {
      top: "18mm",
      right: "16mm",
      bottom: "20mm",
      left: "16mm",
    },
  });
} finally {
  await browser.close();
}

const publicationInputs = [
  manifestPath,
  metadataPath,
  printCssPath,
  epubCssPath,
  epubFilterPath,
  fileURLToPath(import.meta.url),
  ...chapterPaths.map((entry) => path.join(bookDir, entry)),
  ...walkFiles(path.join(bookDir, "assets")),
];
const uniqueInputs = [...new Set(publicationInputs)].sort();
const playwrightPackage = JSON.parse(
  fs.readFileSync(
    path.join(rootDir, "node_modules", "playwright", "package.json"),
    "utf8",
  ),
);
const publicationOutputs = [htmlPath, pdfPath, epubPath, epubCoverPath];
const buildManifest = {
  schemaVersion: 1,
  builtAt: new Date().toISOString(),
  tools: {
    node: process.version,
    pandoc: pandocVersion,
    playwright: playwrightPackage.version,
    chromium: chromiumVersion,
  },
  inputs: Object.fromEntries(
    uniqueInputs.map((filePath) => [
      path.relative(rootDir, filePath),
      hashFile(filePath),
    ]),
  ),
  outputs: Object.fromEntries(
    publicationOutputs.map((filePath) => [
      path.relative(outputDir, filePath),
      {
        bytes: fs.statSync(filePath).size,
        sha256: hashFile(filePath),
      },
    ]),
  ),
};
fs.writeFileSync(
  buildManifestPath,
  `${JSON.stringify(buildManifest, null, 2)}\n`,
);

console.log(`Built ${path.relative(rootDir, htmlPath)}`);
console.log(`Built ${path.relative(rootDir, pdfPath)}`);
console.log(`Built ${path.relative(rootDir, epubPath)}`);
console.log(`Built ${path.relative(rootDir, epubCoverPath)}`);
console.log(`Built ${path.relative(rootDir, buildManifestPath)}`);
