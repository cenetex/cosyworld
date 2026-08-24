import sharp from "sharp";

const root = "/Users/ratimics/develop/cosyworld/artifacts/ui-review";
const desktop = [
  ["01-room.png", "01  Room / saved player"],
  ["02-menu.png", "02  Player menu"],
  ["03-location-card.png", "03  Location card"],
  ["04-avatar-card.png", "04  Avatar card"],
  ["05-journal.png", "05  Journal"],
  ["07-first-time.png", "06  First-time entry"],
  ["08-begin-choice.png", "07  Begin choice"],
  ["09-active-hand.png", "08  Active Story Hand"],
  ["10-expanded-hand.png", "09  Expanded hand"],
  ["11-after-first-discard.png", "10  First discard · free"],
  ["12-second-discard-turn.png", "11  Second discard · turn spent"],
  ["13-play-turn-progress.png", "12  Play · turn rope"],
];
const mobile = [
  ["14-mobile-hand.png", "13  Mobile hand"],
  ["15-mobile-expanded-hand.png", "14  Mobile expanded hand"],
  ["16-mobile-play-rope.png", "15  Mobile play rope"],
];

const width = 1548;
const margin = 36;
const gap = 18;
const desktopWidth = 480;
const desktopHeight = 270;
const captionHeight = 42;
const headerHeight = 108;
const desktopRows = 4;
const desktopGridHeight = desktopRows * (desktopHeight + captionHeight) + (desktopRows - 1) * gap;
const mobileHeaderHeight = 74;
const mobileImageHeight = 600;
const mobileCaptionHeight = 44;
const height = headerHeight + desktopGridHeight + mobileHeaderHeight + mobileImageHeight + mobileCaptionHeight + margin;

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function textSvg(text, boxWidth, boxHeight, options = {}) {
  const size = options.size || 18;
  const color = options.color || "#eee8dc";
  const weight = options.weight || 650;
  const x = options.x || 0;
  const y = options.y || Math.round(boxHeight * 0.64);
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
    input: textSvg("COSYWORLD · UI SCREEN REVIEW", width - margin * 2, 50, {
      size: 25,
      color: "#f0dfb4",
      weight: 760,
      tracking: 1.8,
    }),
    left: margin,
    top: 22,
  },
  {
    input: textSvg("Current reachable states · desktop and mobile · no UI changes applied", width - margin * 2, 36, {
      size: 15,
      color: "#9f9a8e",
      weight: 520,
    }),
    left: margin,
    top: 65,
  },
];

for (let index = 0; index < desktop.length; index += 1) {
  const [file, label] = desktop[index];
  const column = index % 3;
  const row = Math.floor(index / 3);
  const left = margin + column * (desktopWidth + gap);
  const top = headerHeight + row * (desktopHeight + captionHeight + gap);
  const framed = await sharp(`${root}/screens/${file}`)
    .resize(desktopWidth, desktopHeight, { fit: "cover" })
    .extend({ top: 1, bottom: 1, left: 1, right: 1, background: "#545047" })
    .resize(desktopWidth, desktopHeight)
    .png()
    .toBuffer();
  composites.push({ input: framed, left, top });
  composites.push({
    input: textSvg(label, desktopWidth, captionHeight, { size: 16, color: "#d7d1c4", weight: 640, y: 28 }),
    left,
    top: top + desktopHeight,
  });
}

const mobileSectionTop = headerHeight + desktopGridHeight;
composites.push({
  input: textSvg("MOBILE · 390 × 844", width - margin * 2, mobileHeaderHeight, {
    size: 18,
    color: "#f0dfb4",
    weight: 720,
    tracking: 1.4,
    y: 48,
  }),
  left: margin,
  top: mobileSectionTop,
});

for (let index = 0; index < mobile.length; index += 1) {
  const [file, label] = mobile[index];
  const columnLeft = margin + index * (desktopWidth + gap);
  const imageWidth = Math.round(mobileImageHeight * 390 / 844);
  const imageLeft = columnLeft + Math.round((desktopWidth - imageWidth) / 2);
  const imageTop = mobileSectionTop + mobileHeaderHeight;
  const framed = await sharp(`${root}/screens/${file}`)
    .resize(imageWidth, mobileImageHeight, { fit: "cover" })
    .extend({ top: 1, bottom: 1, left: 1, right: 1, background: "#545047" })
    .resize(imageWidth, mobileImageHeight)
    .png()
    .toBuffer();
  composites.push({ input: framed, left: imageLeft, top: imageTop });
  composites.push({
    input: textSvg(label, desktopWidth, mobileCaptionHeight, {
      size: 16,
      color: "#d7d1c4",
      weight: 640,
      x: Math.round((desktopWidth - label.length * 8.5) / 2),
      y: 31,
    }),
    left: columnLeft,
    top: imageTop + mobileImageHeight,
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
  .toFile(`${root}/cosyworld-ui-screen-sheet.png`);
