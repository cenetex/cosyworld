"""Build the CosyWorld desktop package with its game and voice services."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = ROOT / "v2/desktop"


def run(args, **kwargs):
    kwargs.setdefault("cwd", ROOT)
    subprocess.run(args, check=True, **kwargs)


def main():
    bundle = DESKTOP / "bundle"
    bundle.mkdir(exist_ok=True)
    rust_env = dict(os.environ)
    rust_env.setdefault("CARGO_BUILD_JOBS", "1")
    rust_env.setdefault("CMAKE_BUILD_PARALLEL_LEVEL", "1")
    if sys.platform == "darwin":
        rust_env["OPENSSL_STATIC"] = "1"
    run(["cargo", "build", "--manifest-path", "v2/orchestrator-rust/Cargo.toml",
         "--release", "--features", "embedded-llama", "--bin", "cosyworld-orchestrator"], env=rust_env)
    target = Path(os.environ.get("CARGO_TARGET_DIR", ROOT / "v2/orchestrator-rust/target"))
    name = "cosyworld-orchestrator.exe" if os.name == "nt" else "cosyworld-orchestrator"
    if sys.platform == "darwin":
        links = subprocess.check_output(["otool", "-L", str(target / "release" / name)], text=True)
        for line in links.splitlines()[1:]:
            library = line.strip().split(" ", 1)[0]
            if not library.startswith(("/usr/lib/", "/System/Library/")):
                raise RuntimeError("The game helper needs a system-only library build: " + library)
    (bundle / "game").mkdir(exist_ok=True)
    shutil.copy2(target / "release" / name, bundle / "game" / name)
    (bundle / "game/build-info.json").write_bytes(subprocess.check_output(
        ["node", "v2/desktop/check-package.mjs", "--manifest"], cwd=ROOT))
    run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
         "--name", "cosyworld-voices", "--distpath", str(bundle / "voice"),
         "--workpath", str(ROOT / ".runtime/desktop-pyinstaller"),
         "--specpath", str(ROOT / ".runtime/desktop-pyinstaller"),
         "--collect-all", "chatterbox", "--collect-all", "perth",
         "--collect-all", "s3tokenizer", "--collect-all", "librosa",
         "--collect-all", "pykakasi", "--collect-data", "transformers",
         "--recursive-copy-metadata", "chatterbox-tts",
         "--hidden-import", "transformers.models.gpt2.modeling_gpt2",
         "v2/local/chatterbox_service.py"],
        env=dict(os.environ, PYINSTALLER_CONFIG_DIR=str(ROOT / ".runtime/pyinstaller-config")))
    voices = bundle / "voices"
    (voices / "assets/voices").mkdir(parents=True, exist_ok=True)
    source = ROOT / "v2/card-game"
    shutil.copy2(source / "voices.json", voices / "voices.json")
    for voice in json.loads((source / "voices.json").read_text())["voices"].values():
        shutil.copy2(source / voice["file"], voices / voice["file"])
    # Carry the package notices beside the helper programs.
    shutil.copy2(ROOT / "LICENSE", bundle / "game/LICENSE")
    metadata = json.loads(subprocess.check_output([
        "cargo", "metadata", "--format-version", "1", "--locked",
        "--manifest-path", str(ROOT / "v2/orchestrator-rust/Cargo.toml"),
        "--features", "embedded-llama"], text=True))
    for package in metadata["packages"]:
        if package["name"] == "llama-cpp-sys-2":
            notice = Path(package["manifest_path"]).parent / "llama.cpp/LICENSE"
            shutil.copy2(notice, bundle / "game/llama.cpp-LICENSE")
    run(["npx", "--no-install", "tauri", "build"], cwd=DESKTOP)


if __name__ == "__main__":
    main()
