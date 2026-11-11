import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { selectBrowser } from "../../scripts/select-ci-browser.mjs";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const config = JSON.parse(read("scripts/fast-smokes.json"));
const names = [
  ...new Set([
    ...config.core,
    "smoke-card-thebes-provisions",
    ...config.rules.flatMap((rule) => rule.smokes),
  ]),
];
const workflow = read(".github/workflows/fast-check.yml");

function fixture() {
  const page = {
    setContent: vi.fn(),
    title: vi.fn(() => "CI browser preflight"),
  };
  const browser = {
    newPage: vi.fn(() => page),
    version: () => "156.0",
    close: vi.fn(),
  };
  const options = {
    source: "executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE",
    access: vi.fn(),
    version: vi.fn(() => "Google Chrome 156.0.8078.79"),
    launch: vi.fn(() => browser),
    log: vi.fn(),
  };
  return { page, browser, options };
}

describe("preinstalled CI Chrome", () => {
  it("checks the executable and version and opens a real page before selecting it", async () => {
    const { page, browser, options } = fixture();
    expect(await selectBrowser(options)).toBe("/usr/bin/google-chrome");
    expect(options.access).toHaveBeenCalledWith("/usr/bin/google-chrome");
    expect(options.launch).toHaveBeenCalledWith({
      executablePath: "/usr/bin/google-chrome",
      headless: true,
      timeout: 15000,
    });
    expect(page.setContent).toHaveBeenCalledWith(
      "<title>CI browser preflight</title>",
    );
    expect(browser.close).toHaveBeenCalledOnce();
  });
  it.each([
    "missing",
    "wrong version",
    "launch failure",
    "page failure",
    "unsupported script",
  ])("retains pinned setup on %s", async (reason) => {
    const { options, page, browser } = fixture();
    if (reason === "missing")
      options.access.mockImplementation(() => {
        throw new Error("ENOENT");
      });
    if (reason === "wrong version")
      options.version.mockReturnValue("unrecognized browser");
    if (reason === "launch failure")
      options.launch.mockRejectedValue(new Error("missing dependency"));
    if (reason === "page failure") {
      page.title.mockReturnValue("wrong");
      browser.close.mockResolvedValue();
    }
    if (reason === "unsupported script") options.source = "chromium.launch()";
    expect(await selectBrowser(options)).toBe("");
    if (reason === "page failure") expect(browser.close).toHaveBeenCalledOnce();
    if (reason === "unsupported script")
      expect(options.access).not.toHaveBeenCalled();
  });
  it.each(names)(
    "%s honors the executable override in its browser launch",
    (name) => {
      const source = read(`v2/scripts/${name.split("@")[0]}.mjs`);
      const launch = source.match(/\.launch\(\{([\s\S]*?)\}\)/)?.[1];
      expect(launch).toContain("executablePath:");
      expect(launch).toContain("process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE");
      if (source.includes("webkit"))
        expect(launch).toMatch(/(?:chromium|webkit)[\s\S]*\? /);
    },
  );
  it("guards only browser setup, never the smoke or aggregate gate", () => {
    for (const step of [
      "Restore Playwright browsers",
      "Use Ubuntu archive for browser dependencies",
      "Install Chromium system dependencies",
    ]) {
      expect(workflow).toContain(
        `- name: ${step}\n        if: steps.system-chrome.outputs.executable == ''`,
      );
    }
    expect(workflow).toContain(
      "if: steps.system-chrome.outputs.executable == '' && steps.playwright-cache.outputs.cache-hit != 'true'",
    );
    expect(workflow).toContain("run: node scripts/select-ci-browser.mjs");
    expect(workflow).toContain("- name: Run ${{ matrix.smoke }}\n        env:");
    expect(workflow).toContain("${{ needs.smoke.result }}");
    expect(workflow).toContain('test "$result" = success');
  });
});
