import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  local: vi.fn(),
  intro: vi.fn(),
  app: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("../v2/card-game/local-service.mjs", () => ({
  setupLocalService: mocks.local,
}));
vi.mock("../v2/card-game/title-intro.mjs", () => ({
  titleIntroWanted: () => true,
  playTitleIntro: mocks.intro,
}));
vi.mock("../v2/card-game/title-logo.mjs", () => ({
  logoSite: () => true,
  worldLogo: () => ({}),
  showToolbarLogo() {},
}));
vi.mock("../v2/card-game/page-fade.mjs", () => ({ arrivePage() {} }));
vi.mock("../v2/card-game/build-info.mjs", () => ({ showBuildInfo() {} }));
vi.mock("../v2/card-game/shared-auth.mjs", () => ({ membersLock: mocks.lock }));
vi.mock("../v2/card-game/app.mjs", () => {
  mocks.app();
  return {};
});
let elements, reload;
beforeEach(() => {
  vi.resetModules();
  elements = new Map(
    ["speech-row", "speaker", "dialogue-advance", "dialogue-text"].map((id) => [
      id,
      {
        hidden: true,
        textContent: "",
        disabled: false,
        focus: vi.fn(),
        addEventListener: vi.fn(),
      },
    ]),
  );
  vi.stubGlobal("document", {
    body: { inert: true },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: (id) => elements.get(id),
  });
  reload = vi.fn();
  vi.stubGlobal("location", {
    href: "http://localhost/?table=test",
    pathname: "/",
    search: "?table=test",
    reload,
  });
  vi.stubGlobal("navigator", { webdriver: true });
  vi.stubGlobal("localStorage", { getItem: () => null });
  mocks.local.mockResolvedValue(false);
  mocks.lock.mockResolvedValue(false);
  mocks.intro.mockResolvedValue();
});
afterEach(() => vi.unstubAllGlobals());
it.each(["local service", "table import"])(
  "releases startup ownership after failed %s",
  async (stage) => {
    if (stage === "local service")
      mocks.local.mockRejectedValue(new Error("offline"));
    else
      mocks.app.mockImplementation(() => {
        throw new Error("table failed");
      });
    await import("../v2/card-game/entry.mjs");
    expect(document.body.inert).toBe(false);
    expect(mocks.intro.mock.calls[0][0].signal.aborted).toBe(true);
    expect(elements.get("speech-row").hidden).toBe(false);
    expect(elements.get("dialogue-text").textContent).toBe("Try again");
    const retry = elements.get("dialogue-advance");
    expect(retry.hidden).toBe(false);
    const click = retry.addEventListener.mock.calls.find(
      ([name]) => name === "click",
    )[1];
    click({ preventDefault() {}, stopImmediatePropagation() {} });
    expect(reload).toHaveBeenCalledOnce();
    expect(retry.disabled).toBe(true);
  },
);
it("releases a successful boot without cancelling its title", async () => {
  await import("../v2/card-game/entry.mjs");
  expect(document.body.inert).toBe(false);
  expect(mocks.intro.mock.calls[0][0].signal.aborted).toBe(false);
  expect(elements.get("speech-row").hidden).toBe(true);
});
