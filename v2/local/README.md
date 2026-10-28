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
.runtime/local-python/bin/python -c 'from chatterbox.tts_turbo import ChatterboxTurboTTS; ChatterboxTurboTTS.from_pretrained(device="cpu")'
COSYWORLD_CHATTERBOX_PYTHON="$PWD/.runtime/local-python/bin/python" npm run play:cards:local
```

Open `http://127.0.0.1:3110/`. The first voice loads the model. Later lines
reuse it. Press Control-C in the terminal to close the local services.

`COSYWORLD_LOCAL_MODEL` chooses another pulled Ollama model.
`COSYWORLD_CHATTERBOX_MODEL=nano` selects Chatterbox Nano; download that model
with `nano=True` in the model download command above.
`COSYWORLD_CHATTERBOX_MODEL_DIR` selects a downloaded model folder.
`COSYWORLD_LOCAL_DATA_DIR` selects the app's data folder; its default is
`~/.cosyworld`. `COSYWORLD_CARD_LOCAL_PORT` and `COSYWORLD_CHATTERBOX_PORT`
select the two local ports. `OLLAMA_URL` selects a loopback Ollama service.

The launcher checks the chosen dialogue model, starts both game services,
and closes its child processes on exit. All game requests use loopback.
Model downloads happen during setup. Runtime voice loading uses local files.

## Checks

```sh
npm run local:test
npx vitest run test/card-local-voice.test.mjs test/card-character-speech.test.mjs
```

The HTTP voice tests use a small WAV fixture. Real model timing and voice
quality need a run with downloaded Ollama and Chatterbox models.
