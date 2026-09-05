use tokio::sync::{broadcast, mpsc, oneshot};

use crate::journal::Journal;
use crate::kernel::KernelPort;
use crate::pipeline::{Pipeline, Snapshot};
use crate::types::{CommitEnvelope, CommitOutcome, PostCommitIntent, WorldEvent};

pub enum WorldCommand {
    Commit {
        envelope: CommitEnvelope,
        respond: oneshot::Sender<CommitOutcome>,
    },
    Snapshot {
        respond: oneshot::Sender<Snapshot>,
    },
    Shutdown,
}

#[derive(Clone)]
pub struct WorldHandle {
    commands: mpsc::Sender<WorldCommand>,
    events: broadcast::Sender<WorldEvent>,
    intents: broadcast::Sender<PostCommitIntent>,
}

impl WorldHandle {
    pub async fn commit(&self, envelope: CommitEnvelope) -> CommitOutcome {
        let (respond, receive) = oneshot::channel();
        if self
            .commands
            .send(WorldCommand::Commit { envelope, respond })
            .await
            .is_err()
        {
            return CommitOutcome::Failed {
                reason: "world loop is not running".to_string(),
            };
        }
        receive.await.unwrap_or(CommitOutcome::Failed {
            reason: "world loop dropped the commit".to_string(),
        })
    }

    pub async fn snapshot(&self) -> Option<Snapshot> {
        let (respond, receive) = oneshot::channel();
        self.commands
            .send(WorldCommand::Snapshot { respond })
            .await
            .ok()?;
        receive.await.ok()
    }

    pub async fn shutdown(&self) {
        let _ = self.commands.send(WorldCommand::Shutdown).await;
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WorldEvent> {
        self.events.subscribe()
    }

    pub fn subscribe_intents(&self) -> broadcast::Receiver<PostCommitIntent> {
        self.intents.subscribe()
    }
}

pub fn spawn<K, J>(mut pipeline: Pipeline<K, J>, event_buffer: usize) -> WorldHandle
where
    K: KernelPort + 'static,
    J: Journal + 'static,
{
    let (commands, mut inbox) = mpsc::channel::<WorldCommand>(64);
    let (events, _) = broadcast::channel::<WorldEvent>(event_buffer.max(1));
    let (intents, _) = broadcast::channel::<PostCommitIntent>(event_buffer.max(1));
    let handle = WorldHandle {
        commands,
        events: events.clone(),
        intents: intents.clone(),
    };
    tokio::spawn(async move {
        while let Some(command) = inbox.recv().await {
            match command {
                WorldCommand::Commit { envelope, respond } => {
                    let outcome = pipeline.commit(envelope);
                    if let CommitOutcome::Committed {
                        events: committed,
                        intents: scheduled,
                        ..
                    } = &outcome
                    {
                        for event in committed {
                            let _ = events.send(event.clone());
                        }
                        for intent in scheduled {
                            let _ = intents.send(intent.clone());
                        }
                    }
                    let _ = respond.send(outcome);
                }
                WorldCommand::Snapshot { respond } => {
                    let _ = respond.send(pipeline.snapshot());
                }
                WorldCommand::Shutdown => break,
            }
        }
    });
    handle
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::journal::SqliteJournal;
    use crate::kernel::FakeKernel;
    use crate::projection::{LedgerProjection, ProjectionRegistry};
    use crate::types::{Action, ActionKind, AuthContext, Rejection, TurnContext};

    fn handle() -> WorldHandle {
        let mut kernel = FakeKernel::new(&[1, 2]);
        kernel.add_actor(7, 1);
        let mut registry = ProjectionRegistry::default();
        registry.register(Box::new(LedgerProjection::default()));
        spawn(
            Pipeline::new(kernel, SqliteJournal::in_memory().unwrap(), registry),
            16,
        )
    }

    fn envelope() -> CommitEnvelope {
        let mut env = CommitEnvelope::new(
            Action {
                actor_id: 7,
                kind: ActionKind::Say {
                    text: "hello".to_string(),
                },
            },
            AuthContext {
                actor_id: 7,
                session_verified: true,
                suspended: false,
            },
        );
        env.intents.push(PostCommitIntent::ScheduleObservation {
            room_id: 1,
            triggering_seq: 1,
        });
        env
    }

    #[tokio::test]
    async fn commit_flows_through_loop_to_broadcast() {
        let world = handle();
        let mut events = world.subscribe();
        let mut intents = world.subscribe_intents();

        let outcome = world.commit(envelope()).await;
        assert!(outcome.is_committed());

        let event = events.recv().await.unwrap();
        assert_eq!(event.kind, "speech");
        assert_eq!(
            intents.recv().await.unwrap(),
            PostCommitIntent::ScheduleObservation {
                room_id: 1,
                triggering_seq: 1
            }
        );
        world.shutdown().await;
    }

    #[tokio::test]
    async fn rejections_broadcast_nothing() {
        let world = handle();
        let mut events = world.subscribe();
        let mut env = CommitEnvelope::new(
            Action {
                actor_id: 7,
                kind: ActionKind::Pass,
            },
            AuthContext {
                actor_id: 7,
                session_verified: false,
                suspended: false,
            },
        );
        env.turn = Some(TurnContext { room_id: 1 });
        let outcome = world.commit(env).await;
        assert_eq!(outcome, CommitOutcome::Rejected(Rejection::Auth));
        assert!(events.try_recv().is_err());
        world.shutdown().await;
    }

    #[tokio::test]
    async fn snapshot_is_available_through_the_loop() {
        let world = handle();
        assert!(world.commit(envelope()).await.is_committed());
        let snap = world.snapshot().await.unwrap();
        assert_eq!(snap.journal_seq, 1);
        world.shutdown().await;
    }
}
