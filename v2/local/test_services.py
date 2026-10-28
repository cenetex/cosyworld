import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import wave
from pathlib import Path

from chatterbox_service import CachedSpeech, create_server
from run import local_environment


class Engine:
    def generate(self, speaker, text):
        if speaker != "vale" or not isinstance(text, str):
            raise ValueError("Choose a line.")
        output = io.BytesIO()
        with wave.open(output, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(24000)
            audio.writeframes(b"\x00\x00" * 2400)
        return output.getvalue()


class ServicesTest(unittest.TestCase):
    def setUp(self):
        self.server = create_server(("127.0.0.1", 0), "x" * 32, Engine())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, token, data):
        return urllib.request.urlopen(urllib.request.Request(
            self.url + "/speech", data=json.dumps(data).encode(),
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}), timeout=2)

    def test_audio_crosses_the_authenticated_http_boundary(self):
        with self.request("x" * 32, {"speaker": "vale", "text": "Hello."}) as response:
            self.assertEqual(response.headers["Content-Type"], "audio/wav")
            with wave.open(io.BytesIO(response.read())) as audio:
                self.assertEqual(audio.getnframes(), 2400)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request("another-token", {"speaker": "vale", "text": "Hello."})
        self.assertEqual(error.exception.code, 403)
        error.exception.close()

    def test_bad_speakers_and_invalid_json_are_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request("x" * 32, {"speaker": "unknown", "text": "Hello."})
        self.assertEqual(error.exception.code, 400)
        error.exception.close()

    def test_launcher_isolates_local_models_from_hosted_settings(self):
        source = {"PATH": "/bin", "OPENROUTER_API_KEY": "private", "COSYWORLD_AI_REGISTRY_JSON": "hosted", "COSYWORLD_CARD_CHARACTER_MODELS_JSON": "hosted"}
        env = local_environment(source, 3110, 3111, "x" * 32, Path(tempfile.gettempdir()))
        self.assertEqual(env["COSYWORLD_AI_BASE_URL"], "http://127.0.0.1:11434/v1")
        self.assertEqual(env["COSYWORLD_CARD_TEXT_PROFILE"], "local")
        self.assertNotIn("OPENROUTER_API_KEY", env)
        self.assertNotIn("COSYWORLD_AI_REGISTRY_JSON", env)

    def test_disk_clips_survive_restart_and_track_reference_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "vale.wav"
            reference.write_bytes(b"reference-one")
            engine = Engine()
            engine.voices = {"vale": {"file": "vale.wav"}}
            engine.voice_root = root
            engine.identity = lambda: "model-one"
            first = CachedSpeech(engine, root / "cache")
            audio = first.generate("vale", "Hello.")
            engine.generate = lambda *_args: self.fail("The disk cache should supply this clip.")
            self.assertEqual(CachedSpeech(engine, root / "cache").generate("vale", "Hello."), audio)
            reference.write_bytes(b"reference-two")
            engine.generate = Engine().generate
            CachedSpeech(engine, root / "cache").generate("vale", "Hello.")
            self.assertEqual(len(list((root / "cache").glob("*.wav"))), 2)


if __name__ == "__main__":
    unittest.main()
