"""Render the closed brass clasp over the unchanged carved-box painting.
Authoring dependencies: Pillow 12.3.0, numpy 2.3.5, CairoSVG 2.8.2.
This is deterministic compositing, not a new image-model generation.
"""
from pathlib import Path
import hashlib
import io
import json

import cairosvg
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, features

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent
SOURCE = ASSETS / "card-back.webp"
OVERLAY = HERE / "clasp.svg"
EXPECTED_SOURCE = "8acc1349faa332899cf4123c2c308489c3c3ffe9b0c9c528f46d76d81caec29f"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def describe(path):
    with Image.open(path) as im:
        return {
            "file": "assets/" + str(path.relative_to(ASSETS)),
            "sha256": sha(path.read_bytes()),
            "bytes": path.stat().st_size,
            "width": im.width,
            "height": im.height,
            "has_alpha": "A" in im.getbands(),
        }


def build():
    source_bytes = SOURCE.read_bytes()
    if sha(source_bytes) != EXPECTED_SOURCE:
        raise ValueError("Card back changed; review the new painting before rebuilding")
    base = Image.open(io.BytesIO(source_bytes)).convert("RGB")
    if base.size != (1024, 1536):
        raise ValueError("Keep the original 1024x1536 composition")
    rendered = cairosvg.svg2png(
        bytestring=OVERLAY.read_bytes(), output_width=1024, output_height=1536
    )
    metal = Image.open(io.BytesIO(rendered)).convert("RGBA")
    rgba = np.array(metal).astype(np.float32)
    rng = np.random.default_rng(1803)
    coarse = rng.normal(127, 40, (96, 64)).clip(0, 255).astype(np.uint8)
    patina = np.array(
        Image.fromarray(coarse).resize(base.size, Image.Resampling.BICUBIC)
        .filter(ImageFilter.GaussianBlur(2)), dtype=np.float32
    )
    grain = rng.normal(0, 2.1, rgba.shape[:2])
    factor = 0.93 + (patina - 127) / 360
    rgba[:, :, :3] = np.clip(
        rgba[:, :, :3] * factor[:, :, None] + grain[:, :, None], 0, 255
    )
    textured = Image.fromarray(rgba.astype(np.uint8))
    alpha = metal.getchannel("A")
    wear = Image.new("RGBA", base.size)
    draw = ImageDraw.Draw(wear)
    for _ in range(350):
        x, y = int(rng.integers(370, 652)), int(rng.integers(545, 925))
        length = int(rng.integers(2, 12))
        draw.line(
            (x, y, x + length, y - int(rng.integers(0, 4))),
            fill=(231, 202, 149, int(rng.integers(15, 50))), width=1
        )
    scratches = np.array(wear)
    scratches[:, :, 3] = (
        scratches[:, :, 3].astype(np.uint16) * np.array(alpha).astype(np.uint16) // 255
    ).astype(np.uint8)
    textured = Image.alpha_composite(textured, Image.fromarray(scratches))
    shadow = Image.new("RGBA", base.size, (15, 14, 12, 0))
    shadow_alpha = Image.new("L", base.size)
    shadow_alpha.paste(alpha, (7, 10))
    shadow_alpha = shadow_alpha.filter(ImageFilter.GaussianBlur(8))
    shadow.putalpha(shadow_alpha.point(lambda a: round(a * 0.78)))
    canvas = Image.alpha_composite(base.convert("RGBA"), shadow)
    canvas = Image.alpha_composite(canvas, textured).convert("RGB")
    # No overall dimming or tint: the original carving outside the clasp is exact.
    before, after = np.array(base), np.array(canvas)
    outside = np.ones(before.shape[:2], dtype=bool)
    outside[480:990, 335:700] = False
    if not np.array_equal(before[outside], after[outside]):
        raise AssertionError("The edit changed the carving outside the clasp")
    if np.abs(before[650:890, 390:630].astype(float) - after[650:890, 390:630]).mean() < 15:
        raise AssertionError("Missing visible lock")
    master = HERE / "card-back-locked.png"
    runtime = ASSETS / "card-back-locked.webp"
    canvas.save(master, optimize=True)
    for quality in (58, 54, 50, 46, 42):
        candidate = io.BytesIO()
        canvas.save(candidate, format="WEBP", quality=quality, method=6)
        if len(candidate.getvalue()) < 300_000:
            runtime.write_bytes(candidate.getvalue())
            break
    else:
        raise ValueError("Runtime artwork exceeds the 300 KB budget")
    with Image.open(runtime) as check:
        check.load()
        if check.size != (1024, 1536) or check.mode != "RGB":
            raise AssertionError("Invalid runtime dimensions or opacity")
    provenance = {
        "asset": "assets/card-back-locked.webp",
        "created": "2026-11-03",
        "status": "composited-review",
        "requirements": "1024x1536, opaque full bleed, the same carved oak box lid with a visibly shut brass lock; no lettering.",
        "generation": {"tool": None, "id": None, "transparent_background": False},
        "source": describe(SOURCE),
        "authoring": {
            "method": "Original SVG clasp, deterministic patina, scratches and contact-shadow compositing",
            "overlay": "assets/locked-card-back/clasp.svg",
            "overlay_sha256": sha(OVERLAY.read_bytes()),
            "recipe": "assets/locked-card-back/build.py",
            "seed": 1803,
            "tools": {"Pillow": Image.__version__, "numpy": np.__version__, "CairoSVG": cairosvg.__version__, "libwebp": features.version("webp")},
            "generation_note": "No new image-model generation; do not invent a generation ID.",
        },
        "master": describe(master),
        "runtime": {**describe(runtime), "encoding": {"format": "webp", "quality": quality, "method": 6}},
        "derivation": "Preserve the full original canvas and carving; add a closed brass shackle and lock with bolted keeper plates. Only the central clasp region changes before WebP encoding. Not the former globally darkened stand-in.",
    }
    (ASSETS / "card-back-locked-provenance.json").write_text(
        json.dumps(provenance, indent=2) + "\n"
    )
    print(json.dumps({"master": provenance["master"], "runtime": provenance["runtime"]}, indent=2))


if __name__ == "__main__":
    build()
