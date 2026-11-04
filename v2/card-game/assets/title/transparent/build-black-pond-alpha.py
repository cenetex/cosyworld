"""Extract Black Pond's black matte, preserving its Lonely Forest lettering.

Run: python v2/card-game/assets/title/transparent/build-black-pond-alpha.py
Authoring dependencies: Pillow==12.3.0 numpy==2.3.5 scipy==1.17.0.
This is a derived cutout, not an originally transparent image generation.
"""
from hashlib import sha256
from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / "lonely-forest-black-pond.webp"
EXPECTED_SOURCE = "02886521d54c97435fc132abe8253d124db7bbcf5bacf165ba3c2ee923385cbf"


def build():
    if sha256(SOURCE.read_bytes()).hexdigest() != EXPECTED_SOURCE:
        raise SystemExit("Black Pond source changed: review the matte recipe first.")
    source = Image.open(SOURCE).convert("RGB")
    if source.size != (1672, 941):
        raise SystemExit("Expected the full 1672 x 941 Black Pond painting.")
    rgb = np.asarray(source, dtype=np.float32)
    maximum = rgb.max(axis=2)
    alpha = np.clip((maximum - 3) / 20, 0, 1)
    # Keep small, dark pigment pockets inside solid strokes. The much larger
    # letter counters and doorway remain open instead of being filled.
    solid = maximum >= 23
    holes = ndimage.binary_fill_holes(solid) & ~solid
    labels, _ = ndimage.label(holes)
    areas = np.bincount(labels.ravel())
    small = np.flatnonzero((areas > 0) & (areas <= 192))
    alpha[np.isin(labels, small[small != 0])] = 1
    # Protect the obsidian lens's dark face, not its surrounding open swash.
    lens = Image.new("L", (126, 76))
    ImageDraw.Draw(lens).ellipse((5, 7, 121, 69), fill=255)
    lens = lens.rotate(28, Image.Resampling.BICUBIC, expand=True)
    mask = Image.new("L", source.size)
    mask.paste(lens, (round(416 - lens.width / 2), round(561 - lens.height / 2)))
    alpha = np.maximum(alpha, np.asarray(mask, dtype=np.float32) / 255)
    alpha8 = np.rint(alpha * 255).astype(np.uint8)
    alpha = alpha8.astype(np.float32) / 255
    # Unpremultiply the black matte so soft edges do not acquire a black halo.
    straight = np.divide(
        rgb, alpha[..., None], out=np.zeros_like(rgb), where=alpha[..., None] > 0
    )
    straight = np.rint(np.clip(straight, 0, 255)).astype(np.uint8)
    master = Image.fromarray(np.dstack((straight, alpha8)))
    black = np.rint(straight.astype(float) * alpha[..., None])
    error = np.abs(black - rgb)
    if error.max() > 3 or np.count_nonzero(alpha8 == 0) < 1_000_000:
        raise SystemExit("Matte failed the black-reconstruction or clear-area check.")
    if not all(alpha8[y, x] == 0 for x, y in [(0, 0), (1671, 0), (0, 940), (1671, 940)]):
        raise SystemExit("Expected fully transparent corners.")
    png = ROOT / "lonely-forest-black-pond.png"
    master.save(png, compress_level=9)
    # Match the existing toolbar crop's geometry; never enlarge this derivative
    # to replace the full-size PNG. Runtime wiring is owned by the toolbar agent.
    toolbar = master.crop((68, 180, 1622, 702)).resize((476, 160), Image.Resampling.LANCZOS)
    webp = ROOT / "lonely-forest-black-pond-toolbar.webp"
    toolbar.save(webp, lossless=True, method=6)
    decoded = Image.open(webp).convert("RGBA")
    if not np.array_equal(np.asarray(toolbar)[:, :, 3], np.asarray(decoded)[:, :, 3]):
        raise SystemExit("Toolbar export changed alpha.")

    def record(path, image):
        data = path.read_bytes()
        return {"file": path.name, "width": image.width, "height": image.height,
                "bytes": len(data), "sha256": sha256(data).hexdigest()}

    provenance = {
        "version": 1,
        "kind": "background-removed derivative of the existing opaque Black Pond title",
        "title_text": "Lonely Forest",
        "treatment": "The Black Pond",
        "source": "assets/title/lonely-forest-black-pond.webp",
        "source_sha256": EXPECTED_SOURCE,
        "recipe": "build-black-pond-alpha.py",
        "master": record(png, master),
        "toolbar": {**record(webp, toolbar), "crop": [68, 180, 1554, 522]},
        "alpha": {"minimum": int(alpha8.min()), "maximum": int(alpha8.max()),
                  "transparent_pixels": int(np.count_nonzero(alpha8 == 0)),
                  "partial_pixels": int(np.count_nonzero((alpha8 > 0) & (alpha8 < 255))),
                  "sha256": sha256(alpha8.tobytes()).hexdigest()},
        "black_reconstruction": {"maximum_channel_error": int(error.max()),
                                 "mean_channel_error": round(float(error.mean()), 8)},
        "notes": ["Full-size canvas unchanged; no upscaling or painted replacement letters.",
                  "Preserves silver/teal letters, extinguished lamp, dark glass, doorway and reflection.",
                  "Black-ground extraction is approximate; it is not a recovered native alpha channel.",
                  "The unrelated generated THE BLACK POND plaques were rejected and are not used."]
    }
    (ROOT / "black-pond-alpha.provenance.json").write_text(
        json.dumps(provenance, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(provenance, indent=2))


if __name__ == "__main__":
    build()
