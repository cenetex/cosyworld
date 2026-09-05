#!/usr/bin/env python3
"""Submit public evaluation fixtures through an existing Fly provider binding."""

import argparse
import base64
import json
import math
import re
import shlex
import subprocess
import time
import urllib.request
from pathlib import Path


def read_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def price(value):
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise ValueError("Model pricing must be a finite nonnegative number")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--app", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--budget", type=float, default=0.50)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if not math.isfinite(args.budget) or not 0 < args.budget <= 0.50:
        parser.error("This evaluation has a maximum total budget of $0.50")
    root = args.directory.resolve()
    pending = root / "pending.json"
    if pending.exists():
        raise RuntimeError("Inspect the saved pending request before another submission")
    requests = read_json(root / "requests.json", [])
    responses = read_json(root / "responses.json", [])
    completed = {row["id"] for row in responses}
    if len(completed) != len(responses):
        raise ValueError("Duplicate response IDs")
    spent = sum(price(row["usage"]["cost"]) for row in responses)
    with urllib.request.urlopen("https://openrouter.ai/api/v1/models", timeout=20) as result:
        models = json.load(result)["data"]
    model = next(row for row in models if row["id"] == args.model)
    rates = model["pricing"]
    input_rate, output_rate = price(rates["prompt"]), price(rates["completion"])
    request_rate = price(rates.get("request", 0))
    root.joinpath("pricing.json").write_text(json.dumps({
        "model": args.model, "checked_at": time.time(), "pricing": rates,
    }, indent=2) + "\n")
    print(f"{len(responses)} saved responses; ${spent:.6f} spent; {len(requests)} next requests")
    reserved = spent
    for request in requests:
        request_id, body = request["id"], request["body"]
        if request_id in completed:
            continue
        if not re.fullmatch(r"[a-z0-9-]{1,100}", request_id):
            raise ValueError("Invalid request ID")
        if body["model"] != args.model or body["max_tokens"] > 224:
            raise ValueError("Request exceeds the fixed model or completion budget")
        if len(responses) >= 72:
            raise RuntimeError("The evaluation reached its request ceiling")
        raw = json.dumps(body, ensure_ascii=False).encode()
        # UTF-8 bytes plus envelope headroom is a conservative input token bound.
        upper = (len(raw) + 1024) * input_rate + body["max_tokens"] * output_rate + request_rate
        if reserved + upper > args.budget:
            raise RuntimeError(f"Request {request_id} exceeds the remaining budget reserve")
        if not args.execute:
            reserved += upper
            continue
        pending.write_text(json.dumps({"id": request_id, "reserved_cost": upper}) + "\n")
        encoded = base64.b64encode(raw).decode()
        # The credential expands inside the existing production machine. The
        # command output contains only the provider response, encoded for framing.
        remote = "\n".join([
            "set -eu",
            "eval_dir=$(mktemp -d /tmp/cosyworld-speech-eval.XXXXXX)",
            "trap 'rm -rf \"$eval_dir\"' EXIT",
            f"printf '%s' {shlex.quote(encoded)} | base64 -d > \"$eval_dir/request.json\"",
            "curl --silent --show-error --max-time 45 "
            "-H \"Authorization: Bearer ${OPENROUTER_API_KEY:?}\" "
            "-H 'Content-Type: application/json' "
            "--data-binary @\"$eval_dir/request.json\" "
            "https://openrouter.ai/api/v1/chat/completions > \"$eval_dir/response.json\"",
            "printf 'COSYWORLD_EVAL:'",
            "base64 -w0 \"$eval_dir/response.json\"",
            "printf '\\n'",
        ])
        started = time.monotonic()
        result = subprocess.run(
            ["fly", "ssh", "console", "--app", args.app, "-C", "sh -lc " + shlex.quote(remote)],
            capture_output=True, text=True, timeout=90, check=True,
        )
        framed = next(line.split(":", 1)[1] for line in result.stdout.splitlines()
                      if line.startswith("COSYWORLD_EVAL:"))
        reply = json.loads(base64.b64decode(framed))
        if "error" in reply:
            root.joinpath("provider-error.json").write_text(json.dumps(reply["error"], indent=2) + "\n")
            raise RuntimeError("Provider error saved for inspection; batch stopped")
        choice = reply["choices"][0]
        usage = reply["usage"]
        cost = price(usage["cost"])
        row = {
            "id": request_id, "requested_model": args.model, "model": reply["model"],
            "provider_request_id": reply["id"], "text": choice["message"]["content"],
            "finish_reason": choice["finish_reason"],
            "usage": {key: usage.get(key) for key in ["prompt_tokens", "completion_tokens", "total_tokens", "cost"]},
            "latency_ms": round((time.monotonic() - started) * 1000),
        }
        responses.append(row)
        temporary = root / "responses.json.tmp"
        temporary.write_text(json.dumps(responses, indent=2) + "\n")
        temporary.replace(root / "responses.json")
        pending.unlink()
        completed.add(request_id)
        spent += cost
        reserved = spent
        print(f"{request_id}: ${cost:.6f}; total ${spent:.6f}", flush=True)
        if cost > upper:
            raise RuntimeError("Provider cost exceeded its pricing reserve; inspect before continuing")
    if not args.execute:
        print(f"Dry run: upper estimate ${reserved:.6f}; pass --execute to submit")


if __name__ == "__main__":
    main()
