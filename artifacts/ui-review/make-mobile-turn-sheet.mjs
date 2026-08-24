import sharp from "sharp";

const root = "/Users/ratimics/develop/cosyworld/artifacts/ui-review";
const panels = [
  ["18-mobile-320-large-closed.png", "320 × 568 · large text · collapsed"],
  ["17-mobile-320-large-open.png", "320 × 568 · large text · log open"],
  ["19-mobile-390-closed.png", "390 × 844 · standard · collapsed"],
  ["20-mobile-390-open.png", "390 × 844 · standard · log open"],
];

const width = 1040;
const margin = 40;
const gap = 24;
const headerHeight = 122;
const panelWidth = 468;
const imageHeight = 620;
const captionHeight = 46;
const panelHeight = imageHeight + captionHeight;
const height = headerHeight + panelHeight * 2 + gap + margin;

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function textSvg(text, boxWidth, boxHeight, options = {}) {
  const size = options.size || 17;
  const color = options.color || "#eee8dc";
  const weight = options.weight || 650;
  const x = options.x || 0;
  const y = options.y || Math.round(boxHeight * 0.66);
  const tracking = options.tracking || 0;
  return Buffer.from(`
    <svg width="${boxWidth}" height="${boxHeight}" xmlns="http://www.w3.org/2000/svg">
      <text x="${x}" y="${y}" fill="${color}" font-family="Arial, Helvetica, sans-serif"
        font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}">${escapeXml(text)}</text>
    </svg>
  `);
}

const composites = [
  {
    input: textSvg("COSYWORLD · MOBILE TURN ROPE REVIEW", width - margin * 2, 48, {
      size: 24,
      color: "#f0dfb4",
      weight: 760,
      tracking: 1.5,
    }),
    left: margin,
    top: 22,
  },
  {
    input: textSvg("Final states · Play, Discard, and combat share one expandable history", width - margin * 2, 34, {
      size: 15,
      color: "#9f9a8e",
      weight: 520,
    }),
    left: margin,
    top: 68,
  },
];

for (let index = 0; index < panels.length; index += 1) {
  const [file, label] = panels[index];
  const column = index % 2;
  const row = Math.floor(index / 2);
  const panelLeft = margin + column * (panelWidth + gap);
  const panelTop = headerHeight + row * (panelHeight + gap);
  const metadata = await sharp(`${root}/screens/${file}`).metadata();
  const imageWidth = Math.round(imageHeight * metadata.width / metadata.height);
  const framed = await sharp(`${root}/screens/${file}`)
    .resize(imageWidth, imageHeight, { fit: "contain" })
    .extend({ top: 1, bottom: 1, left: 1, right: 1, background: "#545047" })
    .resize(imageWidth, imageHeight)
    .png()
    .toBuffer();
  composites.push({
    input: framed,
    left: panelLeft + Math.round((panelWidth - imageWidth) / 2),
    top: panelTop,
  });
  composites.push({
    input: textSvg(label, panelWidth, captionHeight, {
      size: 16,
      color: "#d7d1c4",
      weight: 640,
      x: 12,
      y: 31,
    }),
    left: panelLeft,
    top: panelTop + imageHeight,
  });
}

await sharp({
  create: {
    width,
    height,
    channels: 4,
    background: "#090a08",
  },
})
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(`${root}/cosyworld-mobile-turn-review.png`);
