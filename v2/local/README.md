# CosyWorld on your computer

The local card table embeds llama.cpp for dialogue and uses Chatterbox for voices.
The game keeps its current rules, character profiles, and saved worlds.

## Start the browser game

Install Node 24, Rust, Python 3.11, Git, CMake, and Xcode Command Line Tools.
From the project folder:

```sh
npm ci
python3.11 -m venv .runtime/local-python
.runtime/local-python/bin/python -m pip install -r v2/local/requirements.txt
python3 v2/local/prepare.py --model gemma3:4b
```

Download the voice model once with the same Python environment:

```sh
.runtime/local-python/bin/python v2/local/chatterbox_service.py --model nano --download-model .runtime/models/chatterbox-nano
COSYWORLD_CHATTERBOX_PYTHON="$PWD/.runtime/local-python/bin/python" npm run play:cards:local
```

Open `http://127.0.0.1:3110/` when the launcher reports that it is ready.
It warms Nano on four CPU threads, then loads the dialogue model on Metal.
Press Control-C in the terminal to close the local services.

`COSYWORLD_LOCAL_MODEL` chooses `gemma3:4b` or the lighter `gemma3:1b`.
Prepare the matching model with `prepare.py --model` first.
`COSYWORLD_LLAMA_MODEL` selects an existing GGUF file for development.
`COSYWORLD_LLAMA_CONTEXT` selects 1,024–4,096 tokens; its default is 2,048.
`COSYWORLD_CHATTERBOX_MODEL_DIR` selects a downloaded model folder.
`COSYWORLD_LOCAL_DATA_DIR` selects the app's data folder; its default is
`~/.cosyworld`. `COSYWORLD_CARD_LOCAL_PORT` and `COSYWORLD_CHATTERBOX_PORT`
select the two local ports. For comparison runs, `COSYWORLD_LOCAL_BACKEND=ollama`
uses a pulled local model and `OLLAMA_URL` selects its loopback service.

The launcher checks the chosen dialogue model and starts both game services.
It closes its child processes on exit. All game requests use loopback.
Model downloads happen during setup. Runtime voice loading uses local files.

## Saves and voice clips

Each local table also saves to `saves/` in the app's data folder. Each update
writes a complete temporary file, then replaces the current file. A
`previous.json` file keeps the earlier version. Revision checks protect a
table when two windows save at once. A pending browser copy survives a
restart and retries its file backup on the next launch.

Open Menu to **Save backup** or **Restore a backup**. Imported saves pass the
same game validation as browser saves. The browser keeps the outgoing copy.
The desktop app uses a fixed local origin and its own persistent browser profile.

Generated voice clips stay in `voices/`, up to 128 MiB. Their identity includes
the model weights, voice reference, and spoken words. A fresh voice process
can reuse them. Setup saves the weight digest with file sizes and modification
times. Later launches reuse that digest while those files match.
A single speech queue keeps each character's voice together.
Nano prepares the six voice profiles once and saves them beside the model.
Later starts reuse those profiles. Reference and training weights are released
before play. Saved clips can play while a new line is being generated.

## Memory and speed

The app targets an 8 GiB process budget. Once per second it reads its own
processes and children. On a Mac it charges the larger of resident memory and
physical footprint for each process, plus 512 MiB for the system game window.
The latest reading and sampled peak are in `local-memory.json` in the app data
folder. The desktop app pauses its helpers above the budget and offers Light
dialogue. The source launcher closes its helpers above the budget.

This is a sampled app budget. The operating system and other apps also need
memory. Check sustained play on the target Mac before choosing a model.

With a local game running, measure a resolved card play with:

```sh
python3 v2/local/benchmark.py --samples 3 --data-dir "$HOME/.cosyworld" --output .runtime/local-performance.json
```

The report records the scene hash, first validated line, scene completion,
complete audio readiness, and memory readings. Use `--context` with its exported
scene to compare another build. `--legacy` uses the earlier client's whole-scene
publication point. The [measured results](performance.md) describe the test Mac
and the limits of this small sample.

## Earlier replies

Local play shows each validated spoken line as it arrives. Voice preparation
starts with that line. Later lines join the same exchange in order. A finished
scene keeps the lines already shown and saves their final model details.

Private thoughts and persona updates run after the spoken scene. The next card
cancels older private work. An update applies only to its original turn and
save revision. These updates use the same character facts and text checks as
the spoken scene. They survive a save and restart.

## Checks

```sh
npm run local:test
npx vitest run test/card-local-voice.test.mjs test/card-character-speech.test.mjs
node v2/scripts/smoke-card-local.mjs --real-models
node v2/scripts/smoke-card-local-stream.mjs
```

The HTTP voice tests use a small WAV fixture. Real model timing and voice
quality need a run with downloaded GGUF and Chatterbox models.
The smoke command checks the running local server, real dialogue and speech,
desktop and phone settings, and recovery into a fresh browser profile.
The streaming check times an early validated line and its voice request at
both screen widths.
