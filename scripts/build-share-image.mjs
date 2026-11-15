import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const assets = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "v2",
  "card-game",
  "assets",
);
const WIDTH = 1200;
const HEIGHT = 630;
const out = join(assets, "share", "lonely-forest.jpg");

const shade = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs><radialGradient id="v" cx="50%" cy="50%" r="75%">
      <stop offset="0" stop-color="#14151d" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#14151d" stop-opacity="0.92"/>
    </radialGradient></defs>
    <rect width="100%" height="100%" fill="url(#v)"/>
  </svg>`,
);
const logo = await sharp(
  join(assets, "title", "transparent", "lonely-forest-2.png"),
)
  .resize({ width: 1040 })
  .toBuffer();
const { height: logoHeight } = await sharp(logo).metadata();

mkdirSync(dirname(out), { recursive: true });
await sharp(join(assets, "lonely-forest", "trail.png"))
  .resize(WIDTH, HEIGHT, { fit: "cover" })
  .modulate({ brightness: 0.8, saturation: 0.9 })
  .composite([
    { input: shade },
    {
      input: logo,
      left: (WIDTH - 1040) / 2,
      top: Math.round((HEIGHT - logoHeight) / 2),
    },
  ])
  .jpeg({ quality: 84, mozjpeg: true })
  .toFile(out);
console.log(`wrote ${out}`);
