# CosyWorld on your computer

The local card table uses Ollama for dialogue and Chatterbox for voices.
The game keeps its current rules, character profiles, and saved worlds.

## Start the browser game

Install Node 24, Rust, Python 3.11, Git, and Ollama. From the project folder:

```sh
npm ci
python3.11 -m venv .runtime/local-python
.runtime/local-python/bin/python -m pip install -r v2/local/requirements.txt
ollama pull gemma3:4b
```

Download the voice model once with the same Python environment:

```sh
.runtime/local-python/bin/python v2/local/chatterbox_service.py --model turbo --download-model .runtime/models/chatterbox-turbo
COSYWORLD_CHATTERBOX_PYTHON="$PWD/.runtime/local-python/bin/python" COSYWORLD_CHATTERBOX_MODEL_DIR="$PWD/.runtime/models/chatterbox-turbo" npm run play:cards:local
```

Open `http://127.0.0.1:3110/`. The first voice loads the model. Later lines
reuse it. Press Control-C in the terminal to close the local services.

`COSYWORLD_LOCAL_MODEL` chooses another pulled Ollama model.
`COSYWORLD_CHATTERBOX_MODEL=nano` selects Chatterbox Nano; use `--model nano`
and a matching folder in the download command above.
`COSYWORLD_CHATTERBOX_MODEL_DIR` selects a downloaded model folder.
`COSYWORLD_LOCAL_DATA_DIR` selects the app's data folder; its default is
`~/.cosyworld`. `COSYWORLD_CARD_LOCAL_PORT` and `COSYWORLD_CHATTERBOX_PORT`
select the two local ports. `OLLAMA_URL` selects a loopback Ollama service.

The launcher checks the chosen dialogue model, starts both game services,
and closes its child processes on exit. All game requests use loopback.
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
can reuse them. A single speech queue keeps each character's voice together.

## Checks

```sh
npm run local:test
npx vitest run test/card-local-voice.test.mjs test/card-character-speech.test.mjs
node v2/scripts/smoke-card-local.mjs --real-models
```

The HTTP voice tests use a small WAV fixture. Real model timing and voice
quality need a run with downloaded Ollama and Chatterbox models.
The smoke command checks the running local server, real dialogue and speech,
desktop and phone settings, and recovery into a fresh browser profile.
