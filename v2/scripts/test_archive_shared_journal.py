import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import archive_shared_journal as archive


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dbpath, self.out = self.root / "source.sqlite", self.root / "world.gz"
        self.db = sqlite3.connect(self.dbpath)
        self.addCleanup(self.db.close)
        self.db.executescript("""
          PRAGMA journal_mode=WAL;
          CREATE TABLE card_full_log(seq INTEGER PRIMARY KEY,world TEXT,command TEXT,at INTEGER);
          CREATE TABLE card_full_checkpoints(world TEXT PRIMARY KEY,seq INTEGER,state TEXT);
          CREATE TABLE card_full_packs(hash TEXT PRIMARY KEY,revision TEXT,content TEXT);
        """)
        self.content = '{"schema":1,"files":{}}\n'
        self.pack = hashlib.sha256(self.content.encode()).hexdigest()
        self.state = json.dumps({"version": "full-card-world/100", "pack": self.pack,
                                 "claimed": [1, 0], "game": {"memory": "private " * 1000}})
        self.rows = [(1, "a", '{"op":"seed","state":' + self.state + '}', 10),
                     (2, "b", '{"op":"seed","state":{}}', 20),
                     (9007199254740993, "a", ' { "op" : "claim", "actor": "mara", "note": "λ" } ', 30)]
        self.db.executemany("INSERT INTO card_full_log VALUES(?,?,?,?)", self.rows)
        self.db.execute("INSERT INTO card_full_checkpoints VALUES(?,?,?)", ("a", self.rows[-1][0], self.state))
        self.db.execute("INSERT INTO card_full_packs VALUES(?,?,?)", (self.pack, "1.2.125", self.content))
        self.db.commit()

    def export(self):
        return archive.export(self.dbpath, "a", self.out)

    def read(self):
        with gzip.open(self.out, "rt") as source:
            return [json.loads(raw) for raw in source]

    def write(self, rows):
        with gzip.open(self.out, "wb") as target:
            for row in rows:
                target.write(archive.line(row))

    def test_exact_round_trip_and_no_source_changes(self):
        before = list(self.db.iterdump())
        result = self.export()
        self.assertEqual(list(self.db.iterdump()), before)
        records = self.read()
        self.assertEqual(records[0][4], [self.rows[-1][0], self.state])
        self.assertEqual([r[1:] for r in records if r[0] == "entry"],
                         [[r[0], r[2], r[3]] for r in self.rows if r[1] == "a"])
        self.assertEqual(result["entries"], 2)  # Global gaps are not missing rows.
        self.assertEqual(records[-2], ["pack", self.pack, "1.2.125", self.content])
        self.assertLess(result["compressed_bytes"], result["record_bytes"])
        self.assertEqual(self.out.stat().st_mode & 0o777, 0o600)
        self.assertEqual(archive.verify(self.out, result["sha256"]), result)
        second = self.root / "second.gz"
        self.assertEqual(archive.export(self.dbpath, "a", second), result)
        with self.assertRaises(ValueError):
            self.export()
        self.assertEqual(archive.digest(self.out), result["sha256"])

    def test_snapshot_excludes_a_concurrent_writer(self):
        original = archive.records
        def concurrent(db, world):
            source = original(db, world)
            yield next(source)
            self.db.execute("INSERT INTO card_full_log VALUES(?,?,?,?)", (9007199254740995, "a", '{"op":"release"}', 40))
            self.db.execute("UPDATE card_full_checkpoints SET seq=9007199254740995,state='{}'")
            self.db.commit()
            yield from source
        with patch.object(archive, "records", concurrent):
            result = self.export()
        self.assertEqual(result["head"], 9007199254740993)
        self.assertEqual(result["entries"], 2)
        self.assertEqual(self.read()[0][4], [9007199254740993, self.state])

    def test_checkpoint_and_content_are_optional_for_old_worlds(self):
        self.db.execute("DELETE FROM card_full_checkpoints")
        self.db.execute("DELETE FROM card_full_packs")
        self.db.execute("UPDATE card_full_log SET command=? WHERE seq=1", ('{"op":"seed","state":{}}',))
        self.db.commit()
        self.assertEqual(self.export()["packs"], 0)
        self.assertIsNone(self.read()[0][4])

    def test_upgrade_and_repack_keep_both_exact_content_revisions(self):
        content = '{"schema":1,"files":{"old":false}}\n'
        new = hashlib.sha256(content.encode()).hexdigest()
        self.db.execute("INSERT INTO card_full_packs VALUES(?,?,?)", (new, "later", content))
        commands = [{"op": "upgrade", "from": "full-card-world/100", "to": "full-card-world/101", "pack": self.pack},
                    {"op": "repack", "from": self.pack, "to": new}]
        for i, command in enumerate(commands):
            self.db.execute("INSERT INTO card_full_log VALUES(?,?,?,?)", (9007199254740994 + i, "a", json.dumps(command), 40))
        self.db.commit()
        self.assertEqual(self.export()["packs"], 2)
        self.assertIn(["pack", new, "later", content], self.read())

    def test_corruption_reordering_truncation_and_trusted_digest(self):
        result = self.export()
        rows, raw = self.read(), self.out.read_bytes()
        changes = [rows[:-1], rows + [rows[1]], [rows[0], rows[2], rows[1], *rows[3:]]]
        changed = json.loads(json.dumps(rows))
        changed[2][2] = '{"op":"release"}'
        changes.append(changed)
        for records in changes:
            self.write(records)
            with self.assertRaises(ValueError):
                archive.verify(self.out)
        self.out.write_bytes(raw[:-5])
        with self.assertRaises((EOFError, OSError)):
            archive.verify(self.out)
        self.out.write_bytes(raw)
        with self.assertRaises(ValueError):
            archive.verify(self.out, "0" * 64)
        self.assertEqual(archive.verify(self.out, result["sha256"]), result)

    def test_invalid_source_never_publishes(self):
        for i, sql in enumerate(["UPDATE card_full_checkpoints SET seq=2", "UPDATE card_full_checkpoints SET seq=9007199254740995",
                                 "DELETE FROM card_full_packs", "UPDATE card_full_packs SET content='{}'",
                                 "DELETE FROM card_full_log WHERE seq=1"]):
            with self.subTest(sql=sql):
                invalid = self.root / f"invalid-{i}.sqlite"
                with sqlite3.connect(invalid) as db:
                    self.db.backup(db)
                    db.execute(sql)
                db.close()
                with self.assertRaises(ValueError):
                    archive.export(invalid, "a", self.out)
                self.assertFalse(self.out.exists())
                self.assertEqual(list(self.root.glob(".shared-archive-*")), [])

    def test_missing_database_is_not_created(self):
        missing = self.root / "missing.sqlite"
        with self.assertRaises(sqlite3.OperationalError):
            archive.export(missing, "a", self.out)
        self.assertFalse(missing.exists())

    def test_recomputed_chain_needs_a_trusted_external_digest(self):
        trusted = self.export()["sha256"]
        rows = self.read()
        rows[2][2] = '{"op":"release"}'
        chain = hashlib.sha256(archive.FORMAT.encode()).digest()
        for row in rows[:-1]:
            chain = hashlib.sha256(chain + archive.line(row)).digest()
        rows[-1][-1] = chain.hex()
        self.write(rows)
        archive.verify(self.out)
        with self.assertRaises(ValueError):
            archive.verify(self.out, trusted)


if __name__ == "__main__":
    unittest.main()
