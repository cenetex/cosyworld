# Local app measurements

Measured on 28 October 2026 on an M4 Max MacBook Pro with 36 GiB of memory and
macOS 26.3.1. The baseline is PR #1233 at `7eddaaec`, version 1.1.40. The new
game helper is version 1.2.0. [Raw samples](performance-results.json) and the
[shared scene](benchmark-scene.json) are saved beside this report.

## Scene and speech

Both builds used the same Gemma 3 4B Q4_K_M file, a 2,048-token context, and
Chatterbox Nano on four CPU threads. Each build had a fresh voice cache. The
test played the same resolved lamp card three times, with two seconds between
samples. The game helpers ran in turn on private local ports. The source
launcher managed their speech service and memory readings.

| Median elapsed time             | Earlier local app | New local app | Gain |
| ------------------------------- | ----------------: | ------------: | ---: |
| Reply ready to show             |            6.41 s |        0.82 s | 7.8× |
| Spoken scene complete           |            6.41 s |        1.46 s | 4.4× |
| First complete voice clip ready |            8.45 s |        4.06 s | 2.1× |

The earlier client published at scene completion. The new client publishes its
first validated line and prepares speech at once. Private thoughts and persona
updates follow the spoken scene. Most of the measured gain comes from this
shorter path to the player. The earlier build's median first validated server
line was 0.88 s; the new build's was 0.82 s.

Each run began after its service became ready. The new helper warms the model
during startup. The earlier helper loads its dialogue model on the first scene.
All six foreground samples completed with zero HTTP retries. Two private
updates finished during the native run; the next scene can cancel older work.

These are three samples of one scene. Generated words and audio lengths vary.
The native sampler uses top-k 40 and top-p 0.9; the older adapter uses 64 and
0.95. These figures describe the full app path on this Mac. Longer play and
other MacBook chips need their own measurements.

## Memory

The controlled process tree peaked at **6.52 GiB** with embedded llama.cpp,
compared with **7.81 GiB** for the earlier Ollama stack. Both figures include
a 512 MiB window allowance. The separate packaged native-window check peaked
at **7.09 GiB** during several scenes and voice requests.

The guard reads resident memory and macOS physical footprint for each owned
process. It charges the larger reading for each process and adds the window
allowance. The controlled comparison includes the older Ollama service and its
model worker. Apple GPU buffers share system memory, so their driver figures
are kept separate from this total.

The desktop app pauses its helpers above 8 GiB. Sampling runs once per second.
The 36 GiB test machine provides evidence for the app budget. A full session on
an 8 GiB Mac still needs a separate check with the operating system and other
apps present.

## CPU voice probe and browser check

A separate Nano probe generated two lines on each device. Its second line took
1.03 s on CPU for 3.08 s of audio, and 1.74 s on MPS for 3.16 s of audio.
CPU speech also leaves Metal available for dialogue. The raw probe includes
startup, memory, and audio lengths.

The streaming browser fixture delivered a validated line at 100 ms and completed
the scene at 2,500 ms. Speech preparation began at 105.6 ms on desktop and
105.8 ms on phone. The line appeared at 732 ms and 723 ms, after the card
animation. Each line used one voice request. Both widths passed save and
restore checks with the real packaged game helper and real CPU speech.

## Further Nano profile work

The next voice pass prepares all six reference profiles once and saves their
tensors. It releases 650.8 MiB of reference and training weights during play.
Reference preparation uses inference mode. Saved profile tensors are detached
from training graphs. Cached clips can play while two new lines wait for speech.

In a paired CPU probe, the memory reading after three lines fell from 3.38 GiB
to 2.02 GiB, a 40% drop. Median generation time fell from 26.11 s to 10.09 s.
Other builds were active during this probe, so the times describe that busy
session. The baseline includes first-use conditioning for Mara and the keeper.
The prepared run moves that work to setup. All three fixed-seed WAV hashes
matched their baseline clips exactly. The raw report includes each pair.

## Repeat the check

Start a local app, then run:

```sh
python3 v2/local/benchmark.py --samples 3 --context v2/local/benchmark-scene.json --output .runtime/local-performance.json
node v2/scripts/smoke-card-local.mjs --real-models
node v2/scripts/smoke-card-local-stream.mjs
```

Use `--origin` and `COSYWORLD_LOCAL_SMOKE_ORIGIN` for private test ports. Add
`--data-dir` to collect the launcher's memory snapshot. For the older local
build, reuse the scene and add `--legacy`. Keep the complete process tree in
the memory measurement when the model service runs beside the launcher.
