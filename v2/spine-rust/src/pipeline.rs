//! The single commit pipeline.
//!
//! One `commit()` function replaces the `apply_and_broadcast_*` wrapper
//! family in `main.rs`. The stages are fixed and ordered:
//!
//! ```text
//! authorize → turn preflight → projection preflight → kernel apply
//!          → journal append → projection apply → turn advance → publish
//! ```
//!
//! Fail-closed rules:
//! - Rejection at any pre-kernel stage leaves no journal record and no events.
//! - A kernel rejection is journaled nowhere; rejected input produces no
//!   world event.
//! - Post-commit intents are returned, never executed inside the pipeline;
//!   inference and other IO happen outside the world lock.

use serde::{Deserialize, Serialize};

use crate::journal::{Journal, JournalRecord, JOURNAL_RECORD_VERSION};
use crate::kernel::KernelPort;
use crate::projection::{MutationCtx, ProjectionRegistry, RegistrySnapshot};
use crate::turns::TurnTracker;
use crate::types::{CommitEnvelope, CommitOutcome, Rejection, WorldEvent};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    pub version: u32,
    pub journal_seq: u64,
    pub next_event_seq: u64,
    pub kernel: serde_json::Value,
    pub projections: RegistrySnapshot,
    pub turns: TurnTracker,
}

pub const SNAPSHOT_VERSION: u32 = 1;

pub struct Pipeline<K: KernelPort, J: Journal> {
    kernel: K,
    journal: J,
    registry: ProjectionRegistry,
    turns: TurnTracker,
    journal_seq: u64,
    next_event_seq: u64,
    next_seed: u64,
}

impl<K: KernelPort, J: Journal> Pipeline<K, J> {
    pub fn new(kernel: K, journal: J, registry: ProjectionRegistry) -> Self {
        Self {
            kernel,
            journal,
            registry,
            turns: TurnTracker::default(),
            journal_seq: 0,
            next_event_seq: 1,
            next_seed: 1,
        }
    }

    pub fn registry(&self) -> &ProjectionRegistry {
        &self.registry
    }

    pub fn kernel(&self) -> &K {
        &self.kernel
    }

    pub fn journal(&self) -> &J {
        &self.journal
    }

    /// The one commit path. Every world mutation funnels through here.
    pub fn commit(&mut self, envelope: CommitEnvelope) -> CommitOutcome {
        let action = &envelope.action;

        // 1. Authorize. Identity comes from the edge-verified session context,
        //    rebound to the action's actor here; never from client fields.
        if !envelope.auth.session_verified
            || envelope.auth.suspended
            || envelope.auth.actor_id != action.actor_id
        {
            return CommitOutcome::Rejected(Rejection::Auth);
        }

        // 2. Turn preflight for turn-consuming actions. Turn-exempt verbs
        //    (speech) skip the tracker entirely.
        let turn_room = if action.kind.is_turn_consuming() {
            let Some(turn) = &envelope.turn else {
                return CommitOutcome::Rejected(Rejection::NotYourTurn { room_id: 0 });
            };
            let occupants = self.kernel.room_occupants(turn.room_id);
            if !self
                .turns
                .is_current(turn.room_id, &occupants, action.actor_id)
            {
                return CommitOutcome::Rejected(Rejection::NotYourTurn {
                    room_id: turn.room_id,
                });
            }
            Some(turn.room_id)
        } else {
            None
        };

        // 3. Projection preflight: every mutation must be validatable before
        //    the kernel commits, so projections never contradict it after.
        let ctx = MutationCtx {
            actor_id: action.actor_id,
            tick: self.kernel.tick(),
        };
        if let Err(err) = self.registry.check_all(&envelope.mutations, ctx) {
            return CommitOutcome::Rejected(Rejection::Projection {
                projection: err.projection,
                reason: err.reason,
            });
        }

        // 4. Kernel apply. The seed is allocated here and journaled; replay
        //    reuses the journaled seed, never a fresh one.
        let seed = self.next_seed;
        self.next_seed = self.next_seed.saturating_add(1);
        let outcome = self.kernel.apply(action, seed, true);
        if !outcome.status.is_ok() && outcome.events.is_empty() {
            // Invalid-input class: no public event, no journal record.
            return CommitOutcome::Rejected(Rejection::Kernel {
                status: outcome.status,
            });
        }
        // Accepted, or rule-rejected with a public rejection event: both are
        // journaled history. A rejection applies no projection mutations and
        // does not advance the room turn or played time (the kernel rolls
        // its tick back on non-OK status).
        let succeeded = outcome.status.is_ok();

        // 5. Sequence events and journal the record. If the append fails the
        //    commit fails loudly; recovery is snapshot + replay, the same
        //    path as a cold boot.
        let journal_seq = self.journal_seq + 1;
        let tick = self.kernel.tick();
        let events: Vec<WorldEvent> = outcome
            .events
            .into_iter()
            .map(|event| {
                let seq = self.next_event_seq;
                self.next_event_seq += 1;
                WorldEvent {
                    seq,
                    journal_seq,
                    tick,
                    kind: event.kind,
                    actor_id: event.actor_id,
                    location_id: event.location_id,
                    content: event.content,
                }
            })
            .collect();
        let record = JournalRecord {
            version: JOURNAL_RECORD_VERSION,
            seq: journal_seq,
            action: action.clone(),
            seed,
            advance_tick: true,
            turn_room: turn_room.filter(|_| succeeded),
            mutations: if succeeded {
                envelope.mutations.clone()
            } else {
                Vec::new()
            },
            status: outcome.status,
            events: events.clone(),
        };
        if let Err(err) = self.journal.append(&record) {
            return CommitOutcome::Failed {
                reason: format!("journal append failed at seq {journal_seq}: {err}"),
            };
        }
        self.journal_seq = journal_seq;

        // 6. Projection apply (claim-key idempotent), then turn advance —
        //    accepted actions only.
        if succeeded {
            self.registry.apply_all(&envelope.mutations, ctx);
            if let Some(room_id) = turn_room {
                let occupants = self.kernel.room_occupants(room_id);
                self.turns.advance(room_id, occupants.len());
            }
        }

        CommitOutcome::Committed {
            journal_seq,
            kernel_status: outcome.status,
            events,
            intents: envelope.intents,
        }
    }

    /// Disposable boot accelerator. Snapshots are never authoritative; the
    /// journal is.
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            version: SNAPSHOT_VERSION,
            journal_seq: self.journal_seq,
            next_event_seq: self.next_event_seq,
            kernel: self.kernel.snapshot(),
            projections: self.registry.snapshot(),
            turns: self.turns.clone(),
        }
    }

    /// Restore from a snapshot, failing closed on version mismatch.
    pub fn restore(&mut self, snapshot: &Snapshot) -> Result<(), String> {
        if snapshot.version != SNAPSHOT_VERSION {
            return Err(format!(
                "snapshot version {} != {SNAPSHOT_VERSION}",
                snapshot.version
            ));
        }
        self.kernel.restore(&snapshot.kernel)?;
        self.registry
            .restore(&snapshot.projections)
            .map_err(|e| format!("{}: {}", e.projection, e.reason))?;
        self.turns = snapshot.turns.clone();
        self.journal_seq = snapshot.journal_seq;
        self.next_event_seq = snapshot.next_event_seq;
        Ok(())
    }

    /// Replay journal records through kernel and registry, asserting that
    /// re-derived events match the stored feed bit-for-bit. This is the proof
    /// that the journal alone rebuilds the world.
    pub fn replay(&mut self, records: &[JournalRecord]) -> Result<(), String> {
        for record in records {
            if record.version != JOURNAL_RECORD_VERSION {
                return Err(format!(
                    "journal record {} has unsupported version {}",
                    record.seq, record.version
                ));
            }
            let outcome = self
                .kernel
                .apply(&record.action, record.seed, record.advance_tick);
            if outcome.status != record.status {
                return Err(format!(
                    "replay diverged at seq {}: status {:?} != journaled {:?}",
                    record.seq, outcome.status, record.status
                ));
            }
            let derived: Vec<(String, serde_json::Value)> = outcome
                .events
                .iter()
                .map(|e| (e.kind.clone(), e.content.clone()))
                .collect();
            let stored: Vec<(String, serde_json::Value)> = record
                .events
                .iter()
                .map(|e| (e.kind.clone(), e.content.clone()))
                .collect();
            if derived != stored {
                return Err(format!(
                    "replay diverged at seq {}: events differ from journal",
                    record.seq
                ));
            }
            let ctx = MutationCtx {
                actor_id: record.action.actor_id,
                tick: self.kernel.tick(),
            };
            self.registry.apply_all(&record.mutations, ctx);
            if let Some(room_id) = record.turn_room {
                let occupants = self.kernel.room_occupants(room_id);
                self.turns.advance(room_id, occupants.len());
            }
            self.journal_seq = record.seq;
        }
        self.next_seed = records
            .iter()
            .map(|r| r.seed)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::journal::SqliteJournal;
    use crate::kernel::{FakeKernel, Holder};
    use crate::projection::{ClocksProjection, LedgerProjection};
    use crate::types::{
        Action, ActionKind, AuthContext, KernelStatus, ProjectionMutation, TurnContext,
    };

    fn registry() -> ProjectionRegistry {
        let mut r = ProjectionRegistry::default();
        r.register(Box::new(LedgerProjection::default()));
        r.register(Box::new(ClocksProjection::default()));
        r
    }

    fn pipeline() -> Pipeline<FakeKernel, SqliteJournal> {
        let mut kernel = FakeKernel::new(&[1, 2]);
        kernel.add_actor(7, 1);
        kernel.add_actor(8, 1);
        kernel.add_item(50, Holder::Location(1));
        Pipeline::new(kernel, SqliteJournal::in_memory().unwrap(), registry())
    }

    fn auth(actor_id: u64) -> AuthContext {
        AuthContext {
            actor_id,
            session_verified: true,
            suspended: false,
        }
    }

    fn envelope(actor_id: u64, kind: ActionKind) -> CommitEnvelope {
        let mut env = CommitEnvelope::new(Action { actor_id, kind }, auth(actor_id));
        env.turn = Some(TurnContext { room_id: 1 });
        env
    }

    fn mint(actor: u64, amount: i64, claim: &str) -> ProjectionMutation {
        ProjectionMutation {
            projection: "ledger".to_string(),
            op: "mint".to_string(),
            payload: serde_json::json!({ "actor": actor, "amount": amount }),
            claim_key: Some(claim.to_string()),
        }
    }

    #[test]
    fn unauthorized_commit_leaves_no_trace() {
        let mut p = pipeline();
        let mut env = envelope(7, ActionKind::Pass);
        env.auth.session_verified = false;
        let outcome = p.commit(env);
        assert_eq!(outcome, CommitOutcome::Rejected(Rejection::Auth));
        assert_eq!(p.journal.latest_seq().unwrap(), 0);
    }

    #[test]
    fn out_of_turn_commit_leaves_no_trace() {
        let mut p = pipeline();
        // Actor 7 takes the first turn; actor 8 is now waiting.
        assert!(p.commit(envelope(7, ActionKind::Pass)).is_committed());
        let outcome = p.commit(envelope(7, ActionKind::Pass));
        assert_eq!(
            outcome,
            CommitOutcome::Rejected(Rejection::NotYourTurn { room_id: 1 })
        );
        assert_eq!(p.journal.latest_seq().unwrap(), 1);
    }

    #[test]
    fn kernel_rule_rejection_journals_public_rejection() {
        let mut p = pipeline();
        let outcome = p.commit(envelope(7, ActionKind::PickUp { item: 999 }));
        match outcome {
            CommitOutcome::Committed {
                kernel_status,
                events,
                ..
            } => {
                assert_eq!(kernel_status, KernelStatus::NotFound);
                assert_eq!(events[0].kind, "rule.rejected");
            }
            other => panic!("expected journaled rejection, got {other:?}"),
        }
        // The rejection is history: journaled, but no tick, no turn advance,
        // no mutations.
        assert_eq!(p.journal.latest_seq().unwrap(), 1);
        assert_eq!(p.kernel.tick(), 0);
        let record = &p.journal.read_from(0, 10).unwrap()[0];
        assert_eq!(record.status, KernelStatus::NotFound);
        assert!(record.mutations.is_empty());
        assert_eq!(record.turn_room, None);
        // It is still actor 7's turn: a failed play does not consume it.
        assert!(p.commit(envelope(7, ActionKind::Pass)).is_committed());
    }

    #[test]
    fn invalid_input_leaves_no_trace() {
        let mut p = pipeline();
        // Actor 999 does not exist: invalid-input class, no public event.
        // (Say is turn-exempt, so the commit reaches the kernel.)
        let mut env = envelope(
            999,
            ActionKind::Say {
                text: "ghost".to_string(),
            },
        );
        env.turn = None;
        env.auth.actor_id = 999;
        let outcome = p.commit(env);
        assert!(matches!(
            outcome,
            CommitOutcome::Rejected(Rejection::Kernel { .. })
        ));
        assert_eq!(p.journal.latest_seq().unwrap(), 0);
    }

    #[test]
    fn speech_is_turn_exempt_and_journaled() {
        let mut p = pipeline();
        let mut env = envelope(
            7,
            ActionKind::Say {
                text: "hello, room".to_string(),
            },
        );
        env.turn = None; // speech carries no turn context
        let outcome = p.commit(env);
        match outcome {
            CommitOutcome::Committed {
                kernel_status,
                events,
                ..
            } => {
                assert_eq!(kernel_status, KernelStatus::Ok);
                assert_eq!(events[0].kind, "speech");
            }
            other => panic!("expected commit, got {other:?}"),
        }
        assert_eq!(p.journal.latest_seq().unwrap(), 1);
    }

    #[test]
    fn committed_mutations_apply_with_claim_discipline() {
        let mut p = pipeline();
        let mut env = envelope(7, ActionKind::Pass);
        env.mutations.push(mint(7, 5, "mint:1"));
        assert!(p.commit(env).is_committed());
        let ledger: &LedgerProjection = p.registry().get("ledger").unwrap();
        assert_eq!(ledger.balance(7), 5);
    }

    #[test]
    fn invalid_mutation_rejects_before_kernel_runs() {
        let mut p = pipeline();
        let mut env = envelope(7, ActionKind::Pass);
        env.mutations.push(ProjectionMutation {
            projection: "ledger".to_string(),
            op: "spend".to_string(),
            payload: serde_json::json!({ "actor": 7, "amount": 5 }),
            claim_key: Some("spend:1".to_string()),
        });
        let outcome = p.commit(env);
        assert!(matches!(
            outcome,
            CommitOutcome::Rejected(Rejection::Projection { .. })
        ));
        assert_eq!(p.journal.latest_seq().unwrap(), 0);
        assert_eq!(p.kernel.tick(), 0, "kernel never saw the rejected commit");
    }

    /// The golden test: journal alone rebuilds the world. Commit a mixed
    /// sequence, snapshot, then rebuild a fresh pipeline from nothing but
    /// journal records and assert identical state.
    #[test]
    fn golden_replay_rebuilds_identical_state() {
        let mut p = pipeline();
        let commits = vec![
            envelope(7, ActionKind::PickUp { item: 50 }),
            envelope(8, ActionKind::Search { item: 60 }),
            {
                let mut e = envelope(7, ActionKind::Move { destination: 2 });
                e.mutations.push(mint(7, 5, "mint:search"));
                e
            },
            envelope(8, ActionKind::Pass),
        ];
        for env in commits {
            assert!(p.commit(env).is_committed());
        }
        let golden = p.snapshot();

        let records = p.journal.read_from(0, 1000).unwrap();
        assert_eq!(records.len(), 4);

        let mut kernel = FakeKernel::new(&[1, 2]);
        kernel.add_actor(7, 1);
        kernel.add_actor(8, 1);
        kernel.add_item(50, Holder::Location(1));
        let mut replayed: Pipeline<FakeKernel, SqliteJournal> =
            Pipeline::new(kernel, SqliteJournal::in_memory().unwrap(), registry());
        replayed.replay(&records).unwrap();

        // Kernel state, projection state, claims, and turn rotation all match.
        assert_eq!(replayed.kernel.snapshot(), golden.kernel);
        let a: &LedgerProjection = replayed.registry().get("ledger").unwrap();
        assert_eq!(a.balance(7), 5);
        assert!(replayed.registry().claimed("mint:search"));
        assert_eq!(replayed.journal_seq, golden.journal_seq);
        assert_eq!(replayed.snapshot().turns, golden.turns);
    }

    /// Snapshot → restore → continue: the accelerator path must converge with
    /// pure replay, and new commits after restore must keep sequencing.
    #[test]
    fn snapshot_restore_converges_and_continues() {
        let mut p = pipeline();
        assert!(p.commit(envelope(7, ActionKind::Pass)).is_committed());
        assert!(p.commit(envelope(8, ActionKind::Pass)).is_committed());
        let snap = p.snapshot();

        let mut kernel = FakeKernel::new(&[1, 2]);
        kernel.add_actor(7, 1);
        kernel.add_actor(8, 1);
        kernel.add_item(50, Holder::Location(1));
        let mut restored: Pipeline<FakeKernel, SqliteJournal> =
            Pipeline::new(kernel, SqliteJournal::in_memory().unwrap(), registry());
        restored.restore(&snap).unwrap();
        assert_eq!(restored.kernel.tick(), 2);

        // Turn rotation survived: it is actor 7's turn again.
        let outcome = restored.commit(envelope(7, ActionKind::Pass));
        match outcome {
            CommitOutcome::Committed { journal_seq, .. } => assert_eq!(journal_seq, 3),
            other => panic!("expected commit after restore, got {other:?}"),
        }
    }

    #[test]
    fn restore_rejects_version_mismatch() {
        let mut p = pipeline();
        let mut snap = p.snapshot();
        snap.version = 99;
        assert!(p.restore(&snap).is_err());
    }
}
