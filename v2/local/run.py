"""Start CosyWorld with local dialogue and character voices."""
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def local_environment(source, port, speech_port, token, data_dir):
    # Start from system settings. A local app gets its own model configuration.
    env = {key: value for key, value in source.items()
           if not key.startswith(("COSYWORLD_", "OPENROUTER_", "OPENAI_"))}
    model = source.get("COSYWORLD_LOCAL_MODEL", "gemma3:4b")
    if model.endswith(":cloud"):
        raise ValueError("Choose a downloaded local dialogue model.")
    backend = source.get("COSYWORLD_LOCAL_BACKEND", "embedded")
    if backend not in ("embedded", "ollama"):
        raise ValueError("Choose embedded or ollama for local dialogue.")
    ollama = source.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
    from urllib.parse import urlparse
    parsed = urlparse(ollama)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("Choose a loopback URL for Ollama.")
    env.update(COSYWORLD_LOCAL_APP="1", COSYWORLD_PRIMARY_GAME="cards",
               COSYWORLD_V2_ADDR=f"127.0.0.1:{port}",
               COSYWORLD_AI_BASE_URL=("embedded://llama" if backend == "embedded" else ollama + "/v1"), COSYWORLD_AI_MODEL=model,
               COSYWORLD_CARD_TEXT_PROFILE="local", COSYWORLD_LOCAL_DATA_DIR=str(data_dir),
               COSYWORLD_CHATTERBOX_URL=f"http://127.0.0.1:{speech_port}",
               COSYWORLD_CHATTERBOX_TOKEN=token,
               COSYWORLD_CHATTERBOX_MODEL="nano",
               HF_HUB_OFFLINE="1", OLLAMA_NO_CLOUD="1")
    if backend == "embedded":
        from prepare import MODELS
        if model not in MODELS:
            raise ValueError("Choose gemma3:4b or gemma3:1b for dialogue.")
        env["COSYWORLD_LLAMA_MODEL"] = source.get("COSYWORLD_LLAMA_MODEL", str(ROOT / ".runtime/models" / MODELS[model]["file"]))
        env["COSYWORLD_LLAMA_CONTEXT"] = source.get("COSYWORLD_LLAMA_CONTEXT", "2048")
    return env


def main():
    port = int(os.environ.get("COSYWORLD_CARD_LOCAL_PORT", "3110"))
    speech_port = int(os.environ.get("COSYWORLD_CHATTERBOX_PORT", "3111"))
    data_dir = Path(os.environ.get("COSYWORLD_LOCAL_DATA_DIR", Path.home() / ".cosyworld"))
    data_dir.mkdir(parents=True, exist_ok=True)
    env = local_environment(os.environ, port, speech_port, secrets.token_hex(32), data_dir)
    if env["COSYWORLD_AI_BASE_URL"] == "embedded://llama":
        if not Path(env["COSYWORLD_LLAMA_MODEL"]).is_file():
            raise ValueError("Prepare dialogue with: python v2/local/prepare.py")
    else:
        ollama = env["COSYWORLD_AI_BASE_URL"].removesuffix("/v1")
        try:
            request = urllib.request.Request(ollama + "/api/show",
                data=json.dumps({"model":env["COSYWORLD_AI_MODEL"]}).encode(),
                headers={"Content-Type":"application/json"})
            with urllib.request.urlopen(request, timeout=10) as response:
                details = json.load(response)
            if details.get("remote_model") or details.get("remote_host"):
                raise ValueError("Choose a downloaded local dialogue model.")
        except OSError as error:
            raise ValueError("Start Ollama with: ollama serve") from error
    binary = os.environ.get("COSYWORLD_LOCAL_BINARY")
    if not binary:
        build_env = dict(os.environ)
        build_env.setdefault("CARGO_BUILD_JOBS", "1")
        build_env.setdefault("CMAKE_BUILD_PARALLEL_LEVEL", "1")
        subprocess.run(["cargo", "build", "--release", "--features", "embedded-llama", "--bin", "cosyworld-orchestrator"],
                       cwd=ROOT / "v2/orchestrator-rust", check=True, env=build_env)
        target = Path(os.environ.get("CARGO_TARGET_DIR", ROOT / "v2/orchestrator-rust/target"))
        binary = str(target / "release/cosyworld-orchestrator")
    python = os.environ.get("COSYWORLD_CHATTERBOX_PYTHON", sys.executable)
    voice_command = [python, str(Path(__file__).with_name("chatterbox_service.py")),
                     "--port", str(speech_port), "--voices", str(ROOT / "v2/card-game/voices.json"),
                     "--model", env["COSYWORLD_CHATTERBOX_MODEL"],
                     "--device", "cpu", "--warm-model",
                     "--cache-dir", str(data_dir / "voices")]
    voice_command += ["--model-dir", os.environ.get("COSYWORLD_CHATTERBOX_MODEL_DIR", str(ROOT / ".runtime/models/chatterbox-nano"))]
    from memory_budget import MemoryBudget
    budget = MemoryBudget()
    children = []
    def stop():
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
    signal.signal(signal.SIGTERM, lambda *_args: sys.exit(0))
    try:
        children.append(subprocess.Popen(voice_command, env=env))
        # Warm speech first, then load the Metal model beside its steady heap.
        for _attempt in range(600):
            budget.check(data_dir)
            if children[0].poll() is not None:
                raise RuntimeError("The local voice needs another try.")
            try:
                request = urllib.request.Request(f"http://127.0.0.1:{speech_port}/health",
                    headers={"Authorization":"Bearer " + env["COSYWORLD_CHATTERBOX_TOKEN"]})
                with urllib.request.urlopen(request, timeout=1):
                    break
            except OSError:
                time.sleep(0.2)
        else:
            raise RuntimeError("The local voice needs another try.")
        children.append(subprocess.Popen([binary], env=env))
        for _attempt in range(600):
            budget.check(data_dir)
            if any(child.poll() is not None for child in children):
                raise RuntimeError("A local service stopped. Check the messages above.")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1):
                    break
            except OSError:
                time.sleep(0.2)
        else:
            raise RuntimeError("The local game needs a restart. Check the messages above.")
        print(f"CosyWorld: http://127.0.0.1:{port}/", flush=True)
        while all(child.poll() is None for child in children):
            budget.check(data_dir)
            time.sleep(1)
        raise RuntimeError("A local service stopped. Check the messages above.")
    except KeyboardInterrupt:
        pass
    finally:
        stop()


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
