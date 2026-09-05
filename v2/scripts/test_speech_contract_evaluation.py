import base64
import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "speech_transport", Path(__file__).with_name("run-speech-contract-evaluation.py")
)
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.requests = [
            {"id": f"fixture-{index}", "body": {"model": "test/model", "max_tokens": 224,
             "messages": [{"role": "user", "content": "A public fixture."}]}}
            for index in range(2)
        ]
        self.root.joinpath("requests.json").write_text(json.dumps(self.requests))

    def run_command(self, flags, response=None):
        models = {"data": [{"id": "test/model", "pricing": {
            "prompt": "0.0000002", "completion": "0.0000012",
        }}]}
        encoded = base64.b64encode(json.dumps(response or {}).encode()).decode()
        with patch("sys.argv", ["evaluation", str(self.root), "--app", "test-app",
                                "--model", "test/model", *flags]), \
                patch.object(transport.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(models).encode())), \
                patch.object(transport.subprocess, "run") as submit, \
                contextlib.redirect_stdout(io.StringIO()):
            submit.return_value.stdout = "COSYWORLD_EVAL:" + encoded
            try:
                transport.main()
            finally:
                self.submitted = submit.call_count

    def test_default_run_quotes_the_budget_before_submission(self):
        self.run_command([])
        self.assertEqual(self.submitted, 0)
        self.assertFalse(self.root.joinpath("pending.json").exists())

    def test_insufficient_reserve_stops_before_submission(self):
        with self.assertRaisesRegex(RuntimeError, "remaining budget"):
            self.run_command(["--execute", "--budget", "0.000001"])
        self.assertEqual(self.submitted, 0)

    def test_ambiguous_prior_submission_requires_inspection(self):
        self.root.joinpath("pending.json").write_text('{"id":"fixture-0"}')
        with self.assertRaisesRegex(RuntimeError, "pending request"):
            self.run_command(["--execute"])
        self.assertEqual(self.submitted, 0)

    def test_provider_rejection_stops_the_batch_and_preserves_the_pending_id(self):
        with self.assertRaisesRegex(RuntimeError, "Provider error"):
            self.run_command(["--execute"], {"error": {"code": 402}})
        self.assertEqual(self.submitted, 1)
        self.assertEqual(json.loads(self.root.joinpath("pending.json").read_text())["id"], "fixture-0")

    def test_cost_above_the_reserve_is_saved_before_the_batch_stops(self):
        with self.assertRaisesRegex(RuntimeError, "pricing reserve"):
            self.run_command(["--execute"], {
                "id": "provider-1", "model": "test/model", "usage": {"cost": 0.02},
                "choices": [{"finish_reason": "stop", "message": {"content": "A reply."}}],
            })
        self.assertEqual(self.submitted, 1)
        self.assertEqual(len(json.loads(self.root.joinpath("responses.json").read_text())), 1)
        self.assertFalse(self.root.joinpath("pending.json").exists())


if __name__ == "__main__":
    unittest.main()
