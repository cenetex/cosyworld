"""Local character speech. Run with Python 3.11 and chatterbox-tts installed."""
import argparse
import io
import json
import os
from pathlib import Path
import secrets
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


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


def create_server(address, token, engine):
    class Handler(BaseHTTPRequestHandler):
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
                audio = engine.generate(data.get("speaker"), data.get("text"))
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
    parser.add_argument("--voices", type=Path, required=True)
    parser.add_argument("--model", choices=["turbo", "nano"], default="turbo")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--model-dir", type=Path)
    args = parser.parse_args()
    token = os.environ.get("COSYWORLD_CHATTERBOX_TOKEN", "")
    if len(token) < 32:
        parser.error("Start Chatterbox through the CosyWorld launcher.")
    os.environ["HF_HUB_OFFLINE"] = "1"
    engine = SpeechEngine(args.voices, args.model, args.device, args.model_dir)
    server = create_server(("127.0.0.1", args.port), token, engine)
    print("CosyWorld voices ready on", server.server_port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
