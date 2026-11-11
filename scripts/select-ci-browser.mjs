// The hosted image supplies official Chrome. Check it with Playwright before
// using it; otherwise retain the workflow's pinned Chromium installation.
import { accessSync, appendFileSync, constants, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

export async function selectBrowser({
  source,
  executable = "/usr/bin/google-chrome",
  access = (file) => accessSync(file, constants.X_OK),
  version = (file) =>
    execFileSync(file, ["--version"], {
      encoding: "utf8",
      timeout: 10000,
    }).trim(),
  launch = (options) => chromium.launch(options),
  log = console.log,
}) {
  // Changed smoke scripts can be selected even outside fast-smokes.json.
  if (!source.includes("PLAYWRIGHT_CHROMIUM_EXECUTABLE")) return "";
  let browser;
  try {
    access(executable);
    const installed = version(executable);
    if (!/^Google Chrome \d+\./.test(installed)) return "";
    browser = await launch({
      executablePath: executable,
      headless: true,
      timeout: 15000,
    });
    const page = await browser.newPage();
    await page.setContent("<title>CI browser preflight</title>");
    if ((await page.title()) !== "CI browser preflight")
      throw new Error("Chrome page preflight failed");
    log(
      `Using ${installed} at ${executable}; Playwright reports ${browser.version()}`,
    );
    await browser.close();
    browser = undefined;
    return executable;
  } catch (error) {
    log(
      `Preinstalled Chrome unavailable: ${error.message}; installing pinned Chromium.`,
    );
    return "";
  } finally {
    await browser?.close().catch(() => {});
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const smoke = process.env.SMOKE?.split("@")[0];
  if (!/^[\w-]+$/.test(smoke || ""))
    throw new Error("Missing or invalid smoke name");
  const source = readFileSync(
    new URL(`../v2/scripts/${smoke}.mjs`, import.meta.url),
    "utf8",
  );
  const executable = await selectBrowser({ source });
  appendFileSync(process.env.GITHUB_OUTPUT, `executable=${executable}\n`);
  if (executable)
    appendFileSync(
      process.env.GITHUB_ENV,
      `PLAYWRIGHT_CHROMIUM_EXECUTABLE=${executable}\n`,
    );
}
