"""Time one resolved card play through a running local app."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import platform
import statistics
import subprocess
import time
import urllib.parse
import urllib.error
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[2]


def request(origin, path, value=None, stream=False):
    headers = {"Content-Type": "application/json"}
    if stream:
        headers["Accept"] = "text/event-stream"
    body = None if value is None else json.dumps(value).encode()
    for attempt in range(2):
        try:
            response = urllib.request.urlopen(urllib.request.Request(origin + path, data=body, headers=headers), timeout=120)
            response.cosy_retries = attempt
            return response
        except urllib.error.HTTPError as error:
            if attempt or (error.code != 429 and error.code < 500):
                raise
            error.close()
            time.sleep(0.75)


def scene():
    source = """
import {createWorld,legalActions,play} from './v2/card-game/world.mjs';
import {narrativeContext} from './v2/card-game/narrative.mjs';
const world=createWorld({opening:true});
const action=legalActions(world).find(card=>card.kind==='light');
const result=play(world,action);
if(!result.ok)throw Error(result.error);
process.stdout.write(JSON.stringify(narrativeContext(result.state,action)));
"""
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", source], cwd=ROOT))


def speech(origin, line, started):
    with request(origin, "/card-game/local/speech", {"speaker": line["id"], "text": line["text"]}) as response:
        audio = response.read()
    with wave.open(io.BytesIO(audio)) as file:
        duration = file.getnframes() / file.getframerate()
    return {"audio_ready_s": time.perf_counter() - started, "audio_seconds": duration}


def reflection(origin, context):
    try:
        with request(origin, "/card-game/reflections", context, stream=True) as response:
            return any(b'"type":"complete"' in line for line in response)
    except OSError:
        return False


def run(origin, context, pool, legacy=False, audio=True):
    started = time.perf_counter()
    first = None
    speaking = None
    result = None
    with request(origin, "/card-game/text", context, stream=True) as response:
        retries = response.cosy_retries
        for line in response:
            if not line.startswith(b"data:"):
                continue
            value = json.loads(line[5:])
            if value.get("type") == "error":
                raise RuntimeError("This character reply needs another try.")
            if value.get("type") == "delta":
                for part in value["text"].splitlines():
                    entry = json.loads(part)
                    if first is None and entry["id"] in context["speakers"]:
                        first = time.perf_counter() - started
                        if audio and not legacy:
                            speaking = pool.submit(speech, origin, entry, started)
            if value.get("type") == "complete":
                result = value
    complete = time.perf_counter() - started
    if result is None or first is None:
        raise RuntimeError("This scene needs another try.")
    if legacy and audio:
        entry = next(entry for entry in result["entries"] if entry["id"] in context["speakers"])
        speaking = pool.submit(speech, origin, entry, started)
    private = None if legacy else pool.submit(reflection, origin, context)
    output = {"first_validated_line_s": first, "display_ready_s": complete if legacy else first,
              "scene_complete_s": complete, "entries": len(result["entries"]),
              "omitted": result.get("omitted", []),
              "request_retries": retries,
              "private_updates_in_foreground": legacy}
    if speaking:
        output.update(speaking.result(timeout=120))
    return output, private


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default="http://127.0.0.1:3110")
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--legacy", action="store_true", help="Measure the whole-scene display used by PR 1233")
    parser.add_argument("--no-speech", action="store_true")
    parser.add_argument("--context", type=Path, help="Reuse an exported benchmark scene")
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--output", type=Path, default=Path(".runtime/local-performance.json"))
    args = parser.parse_args()
    url = urllib.parse.urlparse(args.origin)
    if url.scheme != "http" or url.hostname not in ("127.0.0.1", "localhost", "::1") or url.username or url.password:
        parser.error("Choose the local app's loopback URL.")
    if not 1 <= args.samples <= 5:
        parser.error("Choose one to five samples.")
    with request(args.origin, "/card-game/local") as response:
        config = json.load(response)
    with request(args.origin, "/meta") as response:
        metadata = json.load(response)
    context = json.loads(args.context.read_text()) if args.context else scene()
    encoded = json.dumps(context, sort_keys=True, separators=(",", ":")).encode()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix(".scene.json").write_text(json.dumps(context, indent=2))
    results, private = [], []
    with ThreadPoolExecutor(max_workers=2) as pool:
        for index in range(args.samples):
            if index:
                time.sleep(2)
            value, pending = run(args.origin, context, pool, args.legacy, not args.no_speech)
            results.append(value)
            if pending:
                private.append(pending)
            print(json.dumps(value), flush=True)
        completed_private = sum(task.result(timeout=120) for task in private)
    report = {"machine": platform.machine(), "system": platform.system(),
              "system_version": platform.mac_ver()[0] or platform.release(),
              "game_version": metadata.get("version"), "dialogue_model": config["dialogueModel"],
              "voice_model": config["voiceModel"], "context_sha256": hashlib.sha256(encoded).hexdigest(),
              "samples": results, "completed_private_updates": completed_private,
              "median_display_ready_s": statistics.median(item["display_ready_s"] for item in results),
              "median_scene_complete_s": statistics.median(item["scene_complete_s"] for item in results),
              "notes": "A few samples of one committed card play after service readiness. Each build uses its own startup warm-up policy. Display readiness uses each client's publication point. Audio readiness measures a complete WAV. Browser paint and audio playback are checked separately."}
    if not args.no_speech:
        report["median_audio_ready_s"] = statistics.median(item["audio_ready_s"] for item in results)
    if args.data_dir:
        path = args.data_dir / "local-memory.json"
        if path.exists():
            report["memory"] = json.loads(path.read_text())
    args.output.write_text(json.dumps(report, indent=2))
    print("Saved", args.output)


if __name__ == "__main__":
    main()
