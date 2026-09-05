# Generated asset retention and capacity

Each world's generated asset directory has a 512 MiB byte budget. Existing
published files, immutable media objects, lineage, and Journal references are
retained. This policy bounds local growth by pausing new generation at capacity.

Before new image or audio generation, the runtime requires 64 MiB of headroom.
Each stored image is already limited to 8 MiB by the provider download contract.
The admission margin allows room for candidate, review, publication, and
immutable-object copies. Concurrent completions still pass the write check.

Every media write acquires the directory's `.asset-budget.lock` file. The lock
is shared across processes and held through the complete scan and atomic write.
The budget includes temporary bytes alongside the existing file during a
replacement. The scan counts all regular-file bytes, including old candidates,
quarantine records, generated audio, and metadata. It requires a complete scan
of at most 50,000 entries; filesystem errors or links stop admission.

The guarded writers cover community art, its quarantine markers and probes,
immutable media objects and their graph, media verdicts, room scenes, resident
images, daily Journal images, and model audio with its receipts and transcripts.
The current ceiling is exposed as `/meta.persistence.generated_asset_limit_bytes`.
The existing byte and file counters remain the observation surface.

## Full-budget behavior

Community-art funding checks headroom before taking Orbs. A previously funded
worker records `generated_asset_storage_limit` before provider submission and
keeps its funded amount. That state stays quiet while the directory is full.
When capacity is restored, the worker can resume under its existing provider
and review attempt limits. Published cards and historical references retain
their files throughout this process. Other image and audio paths check admission
before new provider work, and their storage writes use the same lock.

An existing directory above the ceiling remains readable. A reviewed capacity
increase or an asset migration can restore generation. Operators should use
the immutable asset graph and durable Journal references when planning any
storage migration. The runtime preserves these records and their referenced
files.

## Measurement and validation

The 2026-09-05 measurement found 114,250,928 bytes on primary. The largest
Lonely Forest tenant used 409,380,246 bytes. All seven worlds were healthy.
Alerts cover all seven worlds at 400 MiB on primary and 432 MiB per Lonely Forest
tenant, below the 448 MiB admission boundary.

Tests cover concurrent writers at a small budget, preserved published data,
scan rejection, the real funding handler at capacity, a funded worker with zero
provider attempts, and retry eligibility after capacity returns. Sparse fixture
files exercise the production ceiling with little physical disk use.
