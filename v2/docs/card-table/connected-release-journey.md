# Connected forest and Greece check

Use the successful final save from `smoke-card-forest.mjs`. It must end in the
attic after the forest homecoming, with Vale's personal scarf awarded and its
returned button sewn into that scarf.

The script uses two separate browser contexts. Vale has a desktop view. Mara
has a phone view and starts in her actual theatre. Both create passkeys through
the running service. The original save text is sent as the shared-world input.
Its file hash stays fixed through the run.

Run Node 24 from the exact combined source. Pass the supplied server binary:

```sh
node v2/scripts/smoke-connected-forest-greece.mjs \
  --save /absolute/path/to/final-save-1440.json \
  --binary /absolute/path/to/cosyworld-orchestrator \
  --port 4214 \
  --output /private/tmp/cosyworld-connected-release
```

The source must be committed. The server's version, rules and public asset
identity must match that source. The script also checks its served world module
against the local file. It records the source commit, binary hash and full
public metadata.

The text provider is a local dialogue fixture. Passkey checks, shared commands,
the queue, C rules, physical movement and the action journal use the actual
service. The script creates a separate temporary database. It keeps that
runtime folder for review.

Every play uses the current cards. Real resource actions prepare the lamp and
cloth. Both people board the same ship and reach the Greek harbor. Mara carries
the actual water jar from the well to Dione's table. Both people sail back to
Black Pond. Reload checks cover both people and a phone rider aboard the ship.
The service then restarts against the same database.

The check keeps the scarf and button holders fixed. It keeps the personal
quest's owner, program and original completion. The saved game after restart
must match the saved game before it. The earlier journal stays as an exact
prefix of the reopened journal.

The output folder holds `report.json`, the posted plays in `commands.jsonl`,
the real journal in `journal.jsonl`, `server.log`, and desktop/phone captures.
These files belong with the local release evidence. The report names the
original save hash and any failure.

A local model run can check the route before the shared server window opens:

```sh
node v2/scripts/smoke-connected-forest-greece.mjs \
  --model-only --save /absolute/path/to/final-save-1440.json \
  --output /private/tmp/cosyworld-connected-model
```

The model report identifies its mode. The shared run supplies the passkey,
browser, C and restart evidence.

Use `--first-play-only` with a supplied binary to isolate the first shared
action during a quiet test window. Its report uses mode `shared-first-play`.
That run imports the same save, creates both passkeys, and takes Mara's mask
through her phone controls. The full journey uses the default mode.
