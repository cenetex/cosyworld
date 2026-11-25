import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";

const game = new URL("../v2/card-game/", import.meta.url);
const head = readFileSync(new URL("index.html", game), "utf8").split(
  "</head>",
)[0];
const tag = (key) =>
  head.match(
    new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`),
  )?.[1];

describe("link preview tags", () => {
  it("names the game, describes it and shows a large share image", () => {
    for (const key of [
      "description",
      "og:title",
      "og:description",
      "og:site_name",
      "og:type",
      "og:url",
      "twitter:title",
      "twitter:description",
      "theme-color",
    ])
      expect(tag(key), key).toBeTruthy();
    expect(tag("og:title")).toBe("Lonely Forest");
    expect(head).toContain("<title>Lonely Forest</title>");
    expect(head).toContain(`<link rel="canonical" href="${tag("og:url")}" />`);
    const data = JSON.parse(
      head.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)[1],
    );
    expect(data.name).toBe(tag("og:title"));
    expect(data.description).toBe(tag("description"));
    expect(data.image).toBe(tag("og:image"));
    expect(tag("twitter:card")).toBe("summary_large_image");
    for (const key of ["og:image", "twitter:image"]) {
      const url = new URL(tag(key));
      expect(url.protocol, key).toBe("https:");
      const file = new URL(url.pathname.replace(/^\/card-game\//, ""), game);
      expect(statSync(file).size, key).toBeLessThan(5_000_000);
    }
    expect(tag("og:image:width")).toBe("1200");
    expect(tag("og:image:height")).toBe("630");
  });
});
