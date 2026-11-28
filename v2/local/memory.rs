//! Current process readings plus room for the system web view.
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    process::Command,
};

pub const LIMIT: u64 = 8 * 1024 * 1024 * 1024;
const WINDOW_RESERVE: u64 = 512 * 1024 * 1024;

#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub resident_bytes: u64,
    pub physical_footprint_bytes: u64,
    pub window_reserve_bytes: u64,
    pub charged_bytes: u64,
    pub peak_charged_bytes: u64,
    pub limit_bytes: u64,
    pub process_count: usize,
    pub over_budget: bool,
}

#[cfg(target_os = "macos")]
fn footprint(pid: u32) -> u64 {
    // macOS sys/resource.h: rusage_info_v4, RUSAGE_INFO_V4.
    #[repr(C)]
    struct Usage {
        uuid: [u8; 16],
        values: [u64; 35],
    }
    #[link(name = "proc")]
    unsafe extern "C" {
        fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut Usage) -> i32;
    }
    let mut usage = Usage {
        uuid: [0; 16],
        values: [0; 35],
    };
    // The fixed v4 layout has 16 UUID bytes and 35 aligned u64 fields.
    if unsafe { proc_pid_rusage(pid as i32, 4, &mut usage) } == 0 {
        usage.values[7]
    } else {
        0
    }
}

#[cfg(not(target_os = "macos"))]
fn footprint(_pid: u32) -> u64 {
    0
}

fn owned(root: u32, rows: &BTreeMap<u32, (u32, u64)>) -> BTreeSet<u32> {
    let mut ids = BTreeSet::from([root]);
    loop {
        let next: Vec<_> = rows
            .iter()
            .filter(|(pid, (parent, _))| ids.contains(parent) && !ids.contains(pid))
            .map(|(pid, _)| *pid)
            .collect();
        if next.is_empty() {
            return ids;
        }
        ids.extend(next);
    }
}

pub fn sample(root: u32, peak: &mut u64) -> Result<Snapshot, String> {
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,rss="])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Memory readings need another try.".into());
    }
    let rows: BTreeMap<_, _> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut cells = line.split_whitespace();
            let pid = cells.next()?.parse::<u32>().ok()?;
            let parent = cells.next()?.parse::<u32>().ok()?;
            let rss = cells.next()?.parse::<u64>().ok()?.saturating_mul(1024);
            Some((pid, (parent, rss)))
        })
        .collect();
    let mut resident = 0;
    let mut physical = 0;
    let mut charged = WINDOW_RESERVE;
    let mut count = 0;
    for pid in owned(root, &rows) {
        if let Some((_, rss)) = rows.get(&pid) {
            let current = footprint(pid);
            resident += rss;
            physical += current;
            charged += (*rss).max(current);
            count += 1;
        }
    }
    if count == 0 {
        return Err("Memory readings need another try.".into());
    }
    *peak = (*peak).max(charged);
    Ok(Snapshot {
        resident_bytes: resident,
        physical_footprint_bytes: physical,
        window_reserve_bytes: WINDOW_RESERVE,
        charged_bytes: charged,
        peak_charged_bytes: *peak,
        limit_bytes: LIMIT,
        process_count: count,
        over_budget: charged > LIMIT,
    })
}

pub fn record(data: &Path, value: &Snapshot) {
    let temporary = data.join("local-memory.pending");
    if let Ok(bytes) = serde_json::to_vec(value) {
        if std::fs::write(&temporary, bytes).is_ok() {
            let _ = std::fs::rename(temporary, data.join("local-memory.json"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn readings_follow_only_the_owned_process_tree() {
        let rows = BTreeMap::from([(1, (0, 10)), (2, (1, 20)), (3, (2, 30)), (4, (9, 4000))]);
        assert_eq!(owned(1, &rows), BTreeSet::from([1, 2, 3]));
    }
    #[test]
    fn live_readings_cover_the_current_process_and_window_allowance() {
        let snapshot = sample(std::process::id(), &mut 0).unwrap();
        assert!(snapshot.resident_bytes > 0);
        assert!(snapshot.charged_bytes >= snapshot.resident_bytes + WINDOW_RESERVE);
        assert_eq!(snapshot.limit_bytes, LIMIT);
    }
}
