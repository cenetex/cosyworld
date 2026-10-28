"""Local character speech. Run with Python 3.11 and chatterbox-tts installed."""
import argparse
import hashlib
import io
import json
import multiprocessing
import os
from pathlib import Path
import secrets
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_REVISIONS = {
    "turbo": "749d1c1a46eb10492095d68fbcf55691ccf137cd",
    "nano": "71ccd1d0081b430592cea481f4307e764e07bc64",
}


class SpeechEngine:
    def __init__(self, voices, model="turbo", device="auto", model_dir=None):
        self.voices = json.loads(Path(voices).read_text())["voices"]
        self.voice_root = Path(voices).parent
        self.model_name = model
        self.device = device
        self.model_dir = model_dir
        self.model = None
        self.conditionals = {}
        self.lock = threading.Lock()

    def load(self):
        if self.model is None:
            import torch
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            device = self.device
            if device == "auto":
                device = "cuda" if torch.cuda.is_available() else (
                    "mps" if torch.backends.mps.is_available() else "cpu")
            options = {"device": device, "nano": self.model_name == "nano"}
            self.model = (ChatterboxTurboTTS.from_local(self.model_dir, **options)
                          if self.model_dir else ChatterboxTurboTTS.from_pretrained(**options))

    def identity(self):
        if self.model_dir is None:
            from huggingface_hub import snapshot_download
            self.model_dir = Path(snapshot_download(
                repo_id="ResembleAI/chatterbox-" + self.model_name,
                local_files_only=True))
        files = sorted(Path(self.model_dir).glob("*.safetensors"))
        digest = hashlib.sha256(b"chatterbox-5de7a54-pcm16-v1")
        if not files:
            raise ValueError("Prepare the Chatterbox model files first.")
        for path in files:
            digest.update(path.name.encode())
            with path.open("rb") as file:
                while block := file.read(1024 * 1024):
                    digest.update(block)
        return digest.hexdigest()

    def generate(self, speaker, text):
        if speaker not in self.voices or not isinstance(text, str) or not text.strip():
            raise ValueError("Choose a current character line.")
        if len(text) > 1200 or any(ord(char) < 32 for char in text):
            raise ValueError("Choose a short character line.")
        # Chatterbox holds the active voice on the model. One queue protects
        # that state when two browser tabs ask different characters to speak.
        with self.lock:
            self.load()
            if speaker not in self.conditionals:
                self.model.prepare_conditionals(str(self.voice_root / self.voices[speaker]["file"]))
                self.conditionals[speaker] = self.model.conds
            self.model.conds = self.conditionals[speaker]
            samples = self.model.generate(text).squeeze().detach().cpu().numpy()
            output = io.BytesIO()
            with wave.open(output, "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(self.model.sr)
                audio.writeframes((samples.clip(-1, 1) * 32767).astype("<i2").tobytes())
            return output.getvalue()


class CachedSpeech:
    def __init__(self, engine, directory, max_bytes=128 * 1024 * 1024):
        self.engine = engine
        self.directory = Path(directory)
        self.max_bytes = max_bytes
        self.model_identity = None
        self.lock = threading.Lock()

    def generate(self, speaker, text):
        if speaker not in self.engine.voices or not isinstance(text, str) or not text.strip():
            raise ValueError("Choose a current character line.")
        if len(text) > 1200 or any(ord(char) < 32 for char in text):
            raise ValueError("Choose a short character line.")
        with self.lock:
            if self.model_identity is None:
                self.model_identity = self.engine.identity()
            reference = self.engine.voice_root / self.engine.voices[speaker]["file"]
            key = hashlib.sha256(json.dumps([
                self.model_identity, speaker, hashlib.sha256(reference.read_bytes()).hexdigest(), text
            ], ensure_ascii=False).encode()).hexdigest()
            self.directory.mkdir(parents=True, exist_ok=True)
            path = self.directory / (key + ".wav")
            if path.exists():
                try:
                    audio = path.read_bytes()
                    with wave.open(io.BytesIO(audio)) as saved:
                        if saved.getnframes() <= 0 or len(audio) > 8 * 1024 * 1024:
                            raise ValueError("Refresh this clip.")
                    path.touch()
                    return audio
                except (OSError, ValueError, EOFError, wave.Error):
                    path.unlink(missing_ok=True)
            audio = self.engine.generate(speaker, text)
            temporary = path.with_suffix(".pending")
            temporary.write_bytes(audio)
            temporary.replace(path)
            size = 0
            for item in sorted(self.directory.glob("*.wav"), key=lambda file: file.stat().st_mtime, reverse=True):
                size += item.stat().st_size
                if size > self.max_bytes:
                    item.unlink()
            return audio


def create_server(address, token, engine):
    capacity = threading.BoundedSemaphore(2)
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *_args):
            pass

        def reply(self, status, body, content_type="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            return secrets.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token)

        def do_GET(self):
            if not self.authorized():
                return self.reply(403, b'{}')
            self.reply(200 if self.path == "/health" else 404, b'{"ok":true}')

        def do_POST(self):
            if not self.authorized():
                return self.reply(403, b'{}')
            if self.path != "/speech":
                return self.reply(404, b'{}')
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 8192:
                    return self.reply(413, b'{}')
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError("Choose a character line.")
                if not capacity.acquire(blocking=False):
                    return self.reply(429, b'{"error":"The local voice is busy."}')
                try:
                    audio = engine.generate(data.get("speaker"), data.get("text"))
                finally:
                    capacity.release()
                self.reply(200, audio, "audio/wav")
            except (ValueError, KeyError, TypeError):
                self.reply(400, b'{"error":"Choose a current character line."}')
            except Exception as error:
                print("Chatterbox:", type(error).__name__, str(error), flush=True)
                self.reply(503, b'{"error":"The local voice needs another try."}')

    server = ThreadingHTTPServer(address, Handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=3111)
    parser.add_argument("--voices", type=Path)
    parser.add_argument("--model", choices=["turbo", "nano"], default="turbo")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--download-model", type=Path)
    parser.add_argument("--smoke-voice", type=Path)
    args = parser.parse_args()
    if args.download_model:
        os.environ.pop("HF_HUB_OFFLINE", None)
        from huggingface_hub import snapshot_download
        snapshot_download(repo_id="ResembleAI/chatterbox-" + args.model,
                          revision=MODEL_REVISIONS[args.model], local_dir=args.download_model,
                          allow_patterns=["ve.safetensors", "s3gen_meanflow.safetensors",
                                          f"t3_{args.model}_v1.safetensors", "*.json", "*.txt", "*.pt"])
        return
    if not args.voices or not args.cache_dir:
        parser.error("Choose the character references and voice cache folder.")
    if args.smoke_voice:
        os.environ["HF_HUB_OFFLINE"] = "1"
        engine = SpeechEngine(args.voices, args.model, args.device, args.model_dir)
        args.smoke_voice.write_bytes(engine.generate("vale", "The lamp is warm. Come sit beside me."))
        return
    token = os.environ.get("COSYWORLD_CHATTERBOX_TOKEN", "")
    if len(token) < 32:
        parser.error("Start Chatterbox through the CosyWorld launcher.")
    os.environ["HF_HUB_OFFLINE"] = "1"
    engine = SpeechEngine(args.voices, args.model, args.device, args.model_dir)
    engine = CachedSpeech(engine, args.cache_dir)
    server = create_server(("127.0.0.1", args.port), token, engine)
    print("CosyWorld voices ready on", server.server_port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
