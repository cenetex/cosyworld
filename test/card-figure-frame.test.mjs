import { afterEach, expect, it, vi } from "vitest";
import { createFigureFramer } from "../v2/card-game/figure-frame.mjs";
import { morphFrame } from "../v2/card-game/card-keep.mjs";

class ImageNode extends EventTarget {
  nodeName = "IMG";
  nodeType = 1;
  childNodes = [];
  values = new Map();
  complete = true;
  naturalWidth = 48;
  naturalHeight = 72;
  top = 0;
  bottom = 72;
  left = 24;
  right = 25;
  style = { setProperty: (key, value) => this.values.set(key, value) };
  constructor(source, top) {
    super();
    this.src = source;
    this.top = top;
  }
  get attributes() {
    return [{ name: "src", value: this.src }];
  }
  getAttribute(name) {
    return name === "src" ? this.src : null;
  }
  hasAttribute(name) {
    return name === "src";
  }
  setAttribute(name, value) {
    if (name === "src") this.src = value;
  }
}

function canvasDocument() {
  vi.stubGlobal("Node", { ELEMENT_NODE: 1 });
  vi.stubGlobal("document", {
    createElement: () => {
      let image;
      return {
        getContext: () => ({
          drawImage: (value) => {
            image = value;
          },
          getImageData: () => {
            const data = new Uint8ClampedArray(48 * 72 * 4);
            for (let y = image.top; y < image.bottom; y++)
              for (let x = image.left; x < image.right; x++)
                data[(y * 48 + x) * 4 + 3] = 255;
            return { data };
          },
        }),
      };
    },
  });
}
afterEach(() => vi.unstubAllGlobals());

it("reframes the retained image after a cold sleeping-to-awake source swap", () => {
  canvasDocument();
  const { frameFigure, syncFigureFrame } = createFigureFramer(() =>
    document.createElement("canvas"),
  );
  const kept = new ImageNode("sleep-cold", 36);
  frameFigure(kept);
  expect(kept.values.get("--figure-top")).toBe(0.5);
  const next = new ImageNode("awake-cold", 0);
  next.complete = false;
  frameFigure(next);
  kept.complete = false;
  morphFrame(kept, next, syncFigureFrame);
  kept.top = 0;
  kept.complete = true;
  kept.dispatchEvent(new Event("load"));
  expect(kept.values.get("--figure-top")).toBe(0);
  expect(kept.values.get("--figure-height")).toBe(1);
  // Repeated sleep/wake cycles keep the listener on the visible node.
  kept.src = "sleep-cold";
  kept.dispatchEvent(new Event("load"));
  expect(kept.values.get("--figure-height")).toBe(0.5);
});

it("frames warm replacements immediately and ignores incomplete image bytes", () => {
  canvasDocument();
  const { frameFigure, syncFigureFrame } = createFigureFramer(() =>
    document.createElement("canvas"),
  );
  const kept = new ImageNode("old-warm", 36);
  frameFigure(kept);
  const next = new ImageNode("awake-warm", 0);
  frameFigure(next);
  morphFrame(kept, next, syncFigureFrame);
  expect(kept.values.get("--figure-height")).toBe(1);
  kept.complete = false;
  kept.src = "pending";
  frameFigure(kept);
  expect(kept.values.get("--figure-height")).toBe(1);
});

it("centers the full sleeping silhouette rather than only its head", () => {
  canvasDocument();
  const { frameFigure } = createFigureFramer(() =>
    document.createElement("canvas"),
  );
  const image = new ImageNode("off-center-sleep", 36);
  image.bottom = 68;
  image.left = 2;
  image.right = 42;
  frameFigure(image);
  expect(image.values.get("--figure-center-x")).toBe(22 / 48);
  expect(image.values.get("--figure-center-y")).toBeCloseTo(52 / 72);
  expect(image.values.get("--silhouette-width")).toBe(40 / 48);
  expect(image.values.get("--figure-ratio")).toBe(2 / 3);
});
