import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import wave
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from pathlib import Path

from chatterbox_service import CachedSpeech, create_server, model_identity
from memory_budget import MemoryBudget, owned_rows, LIMIT_BYTES, WINDOW_RESERVE_BYTES
from run import local_environment
from voice_profiles import profile_key


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
        self.assertEqual(env["COSYWORLD_AI_BASE_URL"], "embedded://llama")
        self.assertEqual(env["COSYWORLD_LLAMA_CONTEXT"], "2048")
        self.assertTrue(env["COSYWORLD_LLAMA_MODEL"].endswith("gemma3-4b-q4.gguf"))
        self.assertEqual(env["COSYWORLD_CHATTERBOX_MODEL"], "nano")
        self.assertEqual(env["COSYWORLD_CARD_TEXT_PROFILE"], "local")
        self.assertNotIn("OPENROUTER_API_KEY", env)
        self.assertNotIn("COSYWORLD_AI_REGISTRY_JSON", env)
        compatible = local_environment({"COSYWORLD_LOCAL_BACKEND":"ollama"}, 3110, 3111, "x"*32, Path(tempfile.gettempdir()))
        self.assertEqual(compatible["COSYWORLD_AI_BASE_URL"], "http://127.0.0.1:11434/v1")

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

    def test_voice_identity_reuses_setup_digest_and_tracks_weight_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            weights = root / "voice.safetensors"
            weights.write_bytes(b"weights-one")
            first = model_identity(root)
            with patch("chatterbox_service.hashlib.sha256", side_effect=AssertionError("Use the prepared digest")):
                self.assertEqual(model_identity(root), first)
            weights.write_bytes(b"weights-two")
            self.assertNotEqual(model_identity(root), first)

    def test_voice_profile_keys_follow_the_model_and_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "voice.wav"
            reference.write_bytes(b"one")
            first = profile_key("model-one", reference)
            self.assertEqual(profile_key("model-one", reference), first)
            self.assertNotEqual(profile_key("model-two", reference), first)
            reference.write_bytes(b"two")
            self.assertNotEqual(profile_key("model-one", reference), first)

    def test_saved_audio_plays_while_two_new_lines_wait(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "vale.wav").write_bytes(b"reference")
            engine = Engine()
            engine.voices = {"vale": {"file": "vale.wav"}}
            engine.voice_root = root
            engine.identity = lambda: "model-one"
            cache = CachedSpeech(engine, root / "cache")
            expected = cache.generate("vale", "Hello.")
            release = threading.Event()
            both_waiting = threading.Event()
            entered = []
            original = cache.generate

            def queued(speaker, text):
                entered.append(text)
                if len(entered) == 2:
                    both_waiting.set()
                return original(speaker, text)

            cache.generate = queued
            engine.generate = lambda speaker, text: (
                release.wait(3) and Engine().generate(speaker, text))
            server = create_server(("127.0.0.1", 0), "x" * 32, cache)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def request(text):
                with urllib.request.urlopen(urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/speech",
                    data=json.dumps({"speaker":"vale", "text":text}).encode(),
                    headers={"Authorization":"Bearer " + "x" * 32}), timeout=3) as response:
                    return response.read()

            try:
                with ThreadPoolExecutor(max_workers=3) as pool:
                    first = pool.submit(request, "First new line.")
                    second = pool.submit(request, "Second new line.")
                    try:
                        self.assertTrue(both_waiting.wait(1))
                        self.assertEqual(pool.submit(request, "Hello.").result(timeout=1), expected)
                    finally:
                        release.set()
                    self.assertEqual(first.result(timeout=2), expected)
                    self.assertEqual(second.result(timeout=2), expected)
            finally:
                release.set()
                server.shutdown()
                server.server_close()
                thread.join()

    def test_memory_accounting_follows_owned_children(self):
        rows = {1:(0,10),2:(1,20),3:(2,30),4:(9,4000)}
        self.assertEqual(owned_rows([1], rows), {1:10,2:20,3:30})
        current = MemoryBudget().sample()
        self.assertGreater(current["resident_bytes"], 0)
        self.assertGreaterEqual(current["charged_bytes"], current["resident_bytes"] + WINDOW_RESERVE_BYTES)
        self.assertEqual(current["limit_bytes"], LIMIT_BYTES)

    def test_memory_pause_keeps_its_last_reading(self):
        with tempfile.TemporaryDirectory() as directory:
            budget = MemoryBudget()
            with patch.object(budget, "sample", return_value={"over_budget":True}):
                with self.assertRaisesRegex(RuntimeError, "Choose Light"):
                    budget.check(directory)
            self.assertTrue(json.loads((Path(directory)/"local-memory.json").read_text())["over_budget"])


if __name__ == "__main__":
    unittest.main()
