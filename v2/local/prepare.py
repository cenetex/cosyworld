"""Prepare a pinned GGUF for the embedded dialogue engine."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

MODELS = json.loads(Path(__file__).with_name("models.json").read_text())


def fingerprint(path):
    stat = path.stat()
    return {"bytes": stat.st_size, "modifiedSecs": stat.st_mtime_ns // 1_000_000_000,
            "modifiedNanos": stat.st_mtime_ns % 1_000_000_000}


def verify(path, spec):
    if path.stat().st_size != spec["bytes"]:
        raise ValueError("Refresh the dialogue download.")
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while block := file.read(1024 * 1024):
            digest.update(block)
    if digest.hexdigest() != spec["sha256"]:
        raise ValueError("Refresh the dialogue download.")


def prepare(directory, name):
    if name not in MODELS:
        raise ValueError("Choose gemma3:4b or gemma3:1b for dialogue.")
    spec = MODELS[name]
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / spec["file"]
    ready = path.with_suffix(".verified.json")
    try:
        mark = json.loads(ready.read_text())
        if mark == {"sha256": spec["sha256"], "fingerprint": fingerprint(path)}:
            return path
    except (OSError, ValueError):
        pass
    try:
        verify(path, spec)
    except (OSError, ValueError):
        temporary = path.with_suffix(".download")
        size = 0
        with urllib.request.urlopen(spec["url"], timeout=1800) as response, temporary.open("wb") as file:
            while block := response.read(1024 * 1024):
                size += len(block)
                if size > spec["bytes"]:
                    raise ValueError("The dialogue download needs another try.")
                file.write(block)
        verify(temporary, spec)
        temporary.replace(path)
    temporary = ready.with_suffix(".pending")
    temporary.write_text(json.dumps({"sha256": spec["sha256"], "fingerprint": fingerprint(path)}))
    temporary.replace(ready)
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=MODELS, default="gemma3:4b")
    parser.add_argument("--directory", type=Path, default=Path(".runtime/models"))
    options = parser.parse_args()
    print(prepare(options.directory, options.model))
