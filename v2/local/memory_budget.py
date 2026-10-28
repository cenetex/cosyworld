"""Measure owned processes and keep room for the game window."""
import ctypes
import gc
import json
import os
from pathlib import Path
import subprocess
import sys

MIB = 1024 * 1024
LIMIT_BYTES = 8192 * MIB
WINDOW_RESERVE_BYTES = 512 * MIB


class Usage(ctypes.Structure):
    # macOS sys/resource.h, rusage_info_v4 (RUSAGE_INFO_V4).
    _fields_ = [("uuid", ctypes.c_ubyte * 16), ("values", ctypes.c_uint64 * 35)]


_libproc = None
if sys.platform == "darwin":
    _libproc = ctypes.CDLL("/usr/lib/libproc.dylib")
    _libproc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]


def physical_footprint(pid):
    if _libproc is None:
        return 0
    usage = Usage()
    if _libproc.proc_pid_rusage(pid, 4, ctypes.byref(usage)) == 0:
        return usage.values[7]
    return 0


def owned_rows(roots, rows):
    ids = set(roots)
    while True:
        expanded = ids | {pid for pid, (parent, _) in rows.items() if parent in ids}
        if expanded == ids:
            return {pid: rows[pid][1] for pid in ids if pid in rows}
        ids = expanded


class MemoryBudget:
    def __init__(self, roots=None, limit=LIMIT_BYTES, reserve=WINDOW_RESERVE_BYTES):
        self.roots = [os.getpid()] if roots is None else roots
        self.limit = min(limit, LIMIT_BYTES)
        self.reserve = reserve
        self.peak = 0

    def sample(self):
        result = subprocess.run(["/bin/ps", "-axo", "pid=,ppid=,rss="],
                                capture_output=True, text=True, check=True, timeout=3)
        rows = {}
        for line in result.stdout.splitlines():
            values = line.split()
            if len(values) == 3:
                pid, parent, rss = map(int, values)
                rows[pid] = (parent, rss * 1024)
        owned = owned_rows(self.roots, rows)
        physical = {pid: physical_footprint(pid) for pid in owned}
        resident = sum(owned.values())
        footprint = sum(physical.values())
        # Apple GPU buffers share system memory. Charge the larger reading
        # for each process, then add the separate window allowance.
        charged = sum(max(rss, physical[pid]) for pid, rss in owned.items()) + self.reserve
        self.peak = max(self.peak, charged)
        return {"resident_bytes": resident, "physical_footprint_bytes": footprint,
                "window_reserve_bytes": self.reserve, "charged_bytes": charged,
                "peak_charged_bytes": self.peak, "limit_bytes": self.limit,
                "process_count": len(owned), "over_budget": charged > self.limit}

    def check(self, directory):
        value = self.sample()
        directory = Path(directory)
        temporary = directory / "local-memory.pending"
        try:
            temporary.write_text(json.dumps(value))
            temporary.replace(directory / "local-memory.json")
        except OSError:
            pass
        if value["over_budget"]:
            raise RuntimeError("CosyWorld paused to free memory. Choose Light dialogue, then open the world again.")
        return value


def release_unused_memory():
    gc.collect()
    if sys.platform == "darwin":
        system = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
        system.malloc_zone_pressure_relief.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
        system.malloc_zone_pressure_relief.restype = ctypes.c_size_t
        system.malloc_zone_pressure_relief(None, 0)
