use super::*;

pub(super) type RoomMemoryRetryKey = (u64, u64, u64);
pub(super) type RoomMemoryRetries = BTreeMap<RoomMemoryRetryKey, RoomMemoryRetryState>;

#[derive(Clone, Copy, Debug)]
pub(super) struct RoomMemoryRetryState {
    consecutive_failures: u32,
    retry_at: Instant,
}

impl crate::RuntimeWorld {}
