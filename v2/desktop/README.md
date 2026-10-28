# CosyWorld desktop app

The Tauri app opens the current card game in a desktop window. It bundles the
Rust game service, a Python speech service, and the six character references.
The first package target is macOS on Apple Silicon.

## Use the app

Install Ollama. Open CosyWorld, choose the dialogue model and character voice
model, then choose **Prepare models**. This downloads the chosen models once.
Choose **Play** to enter the world. Close the game window to close the app and
the services it started. An Ollama service that was already open stays open.

The app stores its settings, saves, cached voices, and service log in its
normal application data folder. On a Mac this is
`~/Library/Application Support/chat.rati.cosyworld/`. Its local game URL stays
`http://127.0.0.1:3110/` across updates. The browser profile also stays with the
app. The [local game guide](../local/README.md) explains backups and recovery.

The setup window can prepare models and open the game. The game window uses
the local HTTP service for speech and save files. The setup commands check
the window and its origin before managing programs or downloads.

## Build on a Mac

Install Node 24, Rust, Python 3.11, Git, Xcode Command Line Tools, and OpenSSL 3
development files (`brew install openssl@3`). The game helper links OpenSSL
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

The **Local desktop app** PR workflow builds the Apple Silicon package and
checks real speech with the packaged Nano engine. It uploads an app archive
for review. Public distribution can use the normal Apple signing and
notarization process after review.

The Chatterbox source revision, model revisions, and Python build dependencies
are fixed in `v2/local/requirements-macos.lock` and the speech service.
The app downloads model files during setup and uses local files during play.
