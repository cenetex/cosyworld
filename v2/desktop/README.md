# CosyWorld desktop app

The Tauri app opens the current card game in a desktop window. It bundles the
Rust game service, a Python speech service, and the six character references.
The first package target is macOS on Apple Silicon.

## Use the app

Open CosyWorld, choose Standard or Light dialogue, then choose **Prepare models**.
This downloads and checks the chosen models once. Standard uses a 4-bit Gemma 3
4B model. Light uses a 4-bit Gemma 3 1B model.
Choose **Play** to enter the world. Close the game window to close the app and
the services it started.

The game helper embeds llama.cpp through the pinned `llama-cpp-2` 0.1.160
bindings. On a Mac it uses Metal. One worker owns one model and a 2,048-token
context. Prompt batches hold at most 128 tokens. One prompt prefix is reused
between replies. Cancellation is checked before each batch and generated token.
The helper warms its model before opening the game. Model download hashes and
byte sizes are fixed in `v2/local/models.json`.

Voices use Chatterbox Nano on four CPU threads. Speech warms before Metal loads.
The six reference profiles stay on disk. Play uses their prepared tensors, which
allows the voice engine to release 650 MiB of reference and training weights.
The app checks an 8 GiB process budget once per second, including a 512 MiB
window allowance. Above that limit it pauses its helpers and returns to setup.
Choose Light, prepare its model, then press Play. The latest reading and sampled
peak stay in `local-memory.json`. See the [memory and speed guide](../local/README.md#memory-and-speed).

The app stores its settings, saves, cached voices, and service log in its
normal application data folder. On a Mac this is
`~/Library/Application Support/chat.rati.cosyworld/`. Its local game URL stays
`http://127.0.0.1:3110/` across updates. The browser profile also stays with the
app. The [local game guide](../local/README.md) explains backups and recovery.
For a separate test folder, set `COSYWORLD_LOCAL_DATA_DIR` before launch.
On macOS 14 or later this also selects a separate game browser store.

The setup window can prepare models and open the game. The game window uses
the local HTTP service for speech and save files. The setup commands check
the window and its origin before managing programs or downloads.

## Build on a Mac

Install Node 24, Rust, Python 3.11, Git, Xcode Command Line Tools, and OpenSSL 3
development files (`brew install openssl@3 cmake`). The game helper links OpenSSL
into its binary so the finished app carries its own copy. Then run:

```sh
npm ci
python3.11 -m venv .runtime/local-python
.runtime/local-python/bin/python -m pip install --no-deps -r v2/local/requirements-macos.lock
.runtime/local-python/bin/python v2/desktop/build.py
```

The app is written to
`v2/desktop/src-tauri/target/release/bundle/macos/CosyWorld.app`. When
`CARGO_TARGET_DIR` is set, the bundle is under that folder instead. Keep build
files and model downloads outside source control.

The build uses one Cargo worker and one CMake worker by default. The helper is
built with `--features embedded-llama`. The hosted server keeps its usual build.
Gemma model use follows [the model terms](https://ai.google.dev/gemma/terms).

The web game and Mac app use the release version in `package.json`. The version
command updates both Rust programs and their lock files together. Keep game
changes in `v2/card-game/`; both programs embed those same public files.

The **Local desktop app** workflow runs for relevant PR changes, every push to
`main`, release tags, and manual runs. It builds the Apple Silicon package and
checks real speech with the packaged Nano engine. It compares the running
package's release version, shared rules, voice references, and every public
game file with that commit's web source. The local server also keeps the web
game's image cache, conditional requests, and music byte ranges.
The hosted runner's real-model check uses CPU inference through
`GGML_METAL_DEVICES=0`. The packaged app uses Metal on a Mac during normal play.

Each successful run uploads a versioned app archive, its SHA-256 checksum,
`build-info.json`, and `package-check.json`. The run summary links the download.
The build has a 90-minute job budget. The checked app uploads before the final
build-cache save, which has a separate five-minute budget and is optional.
The Mac build uses an ad-hoc signature to seal the app and its resources.
CI checks the app and both helper signatures after building. It also checks
a fresh extraction of the finished ZIP before upload.
The manifest records the source commit and game asset hash. Both local and web
`/meta` include that hash under `card_game.assets_sha256` for release checks.
Public distribution can use the normal Apple signing and notarization process
after review.

The Chatterbox source revision, model revisions, and Python build dependencies
are fixed in `v2/local/requirements-macos.lock` and the speech service.
The app downloads model files during setup and uses local files during play.
