#!/usr/bin/env python3
"""Private, read-only archive experiment. No restore, replay, or pruning."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

FORMAT = "cosyworld-shared-journal/v1"
MAX_LINE = 64 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def line(record):
    return (json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n").encode()


def digest(path):
    with open(path, "rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def references(state, packs):
    require(isinstance(state, dict), "state or command must be an object")
    pack = state.get("pack")
    if pack is not None:
        require(isinstance(pack, str), "pack reference must be text")
        packs.add(pack)


def command_references(text, packs):
    parsed = json.loads(text)
    references(parsed, packs)
    if parsed.get("op") == "seed":
        references(parsed["state"], packs)
    if parsed.get("op") == "repack":
        references({"pack": parsed.get("to")}, packs)
        references({"pack": parsed.get("from")}, packs)
    return parsed


def records(db, world):
    head = db.execute("SELECT max(seq) FROM card_full_log WHERE world=?", (world,)).fetchone()[0]
    require(head is not None, "world has no journal")
    checkpoint = db.execute("SELECT seq,state FROM card_full_checkpoints WHERE world=?", (world,)).fetchone()
    packs = set()
    if checkpoint:
        references(json.loads(checkpoint[1]), packs)
    yield ["header", FORMAT, world, head, checkpoint]
    for seq, command, at in db.execute(
        "SELECT seq,command,at FROM card_full_log WHERE world=? AND seq<=? ORDER BY seq", (world, head)
    ):
        command_references(command, packs)
        yield ["entry", seq, command, at]
    for pack in sorted(packs):
        row = db.execute("SELECT hash,revision,content FROM card_full_packs WHERE hash=?", (pack,)).fetchone()
        require(row is not None, "referenced pack is missing")
        yield ["pack", *row]


def verify(path, expected_sha256=None):
    """Check structure and bytes, NOT semantic replay or source completeness."""
    chain = hashlib.sha256(FORMAT.encode()).digest()
    last = count = size = 0
    header = footer = None
    needed, saved = set(), set()
    checkpoint_seen = False
    with gzip.open(path, "rb") as source:
        sha = hashlib.file_digest(source.fileobj, "sha256").hexdigest()
        require(expected_sha256 is None or sha == expected_sha256, "archive SHA-256 mismatch")
        compressed_bytes = os.fstat(source.fileobj.fileno()).st_size
        source.fileobj.seek(0)
        while True:
            raw = source.readline(MAX_LINE + 1)
            if not raw:
                break
            require(len(raw) <= MAX_LINE and raw.endswith(b"\n"), "invalid or oversized record")
            require(footer is None, "record follows archive footer")
            r = json.loads(raw)
            require(isinstance(r, list) and r, "invalid record")
            kind = r[0]
            if kind == "end":
                require(r == ["end", count, len(saved), chain.hex()], "archive chain or count mismatch")
                footer = r
                continue
            size += len(raw)
            chain = hashlib.sha256(chain + raw).digest()
            if header is None:
                require(len(r) == 5 and r[:2] == ["header", FORMAT], "invalid archive header")
                _, _, world, head, checkpoint = r
                require(isinstance(world, str) and world and type(head) is int and head > 0, "invalid world or head")
                header = r
                if checkpoint is not None:
                    require(isinstance(checkpoint, list) and len(checkpoint) == 2, "invalid checkpoint")
                    require(type(checkpoint[0]) is int and 0 < checkpoint[0] <= head, "checkpoint beyond journal")
                    references(json.loads(checkpoint[1]), needed)
                continue
            if kind == "entry":
                require(len(r) == 4 and not saved, "invalid entry order")
                _, seq, command, at = r
                require(type(seq) is int and last < seq <= head and type(at) is int, "invalid sequence or time")
                require(isinstance(command, str), "command must retain its original text")
                parsed = command_references(command, needed)
                if count == 0:
                    require(parsed.get("op") == "seed", "journal must begin with a seed")
                if parsed.get("op") == "seed":
                    require(count == 0, "duplicate seed")
                checkpoint_seen |= checkpoint is not None and checkpoint[0] == seq
                last, count = seq, count + 1
            elif kind == "pack":
                require(len(r) == 4 and all(isinstance(v, str) for v in r), "invalid pack")
                _, pack, _, content = r
                require(pack in needed and pack not in saved, "unexpected or duplicate pack")
                require(hashlib.sha256(content.encode()).hexdigest() == pack, "pack hash mismatch")
                saved.add(pack)
            else:
                raise ValueError("unknown record type")
    require(header is not None and footer is not None and count > 0, "incomplete archive")
    require(last == head and (checkpoint is None or checkpoint_seen), "journal or checkpoint cursor missing")
    require(needed == saved, "referenced packs missing")
    return {"sha256": sha, "entries": count, "head": last, "packs": len(saved),
            "record_bytes": size, "compressed_bytes": compressed_bytes}


def export(database, world, output):
    output = Path(output)
    require(not output.exists(), "output already exists")
    # mode=ro does not create a missing database or run runtime schema helpers.
    db = sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True)
    temporary = None
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        fd, temporary = tempfile.mkstemp(prefix=".shared-archive-", dir=output.parent)
        chain = hashlib.sha256(FORMAT.encode()).digest()
        counts = {"entry": 0, "pack": 0}
        with os.fdopen(fd, "wb") as target:
            with gzip.GzipFile(filename="", fileobj=target, mode="wb", mtime=0) as compressed:
                for record in records(db, world):
                    raw = line(record)
                    require(len(raw) <= MAX_LINE, "oversized record")
                    chain = hashlib.sha256(chain + raw).digest()
                    if record[0] in counts:
                        counts[record[0]] += 1
                    compressed.write(raw)
                compressed.write(line(["end", counts["entry"], counts["pack"], chain.hex()]))
            target.flush()
            os.fsync(target.fileno())
        db.rollback()
        result = verify(temporary)
        # Publish only a verified complete file, atomically and without replacing.
        os.link(temporary, output)
        return result
    finally:
        db.close()
        if temporary is not None:
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("export")
    create.add_argument("--database", required=True)
    create.add_argument("--world", required=True)
    create.add_argument("--output", required=True)
    check = sub.add_parser("verify")
    check.add_argument("archive")
    check.add_argument("--sha256", help="trusted digest retained separately from the archive")
    args = parser.parse_args()
    if args.command == "export":
        result = export(args.database, args.world, args.output)
    else:
        result = verify(args.archive, args.sha256)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
