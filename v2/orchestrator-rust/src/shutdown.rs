use super::*;
use futures_util::StreamExt as FuturesStreamExt;
use std::{
    fmt,
    sync::atomic::{AtomicU64, Ordering},
};
use tokio::sync::watch;
use tokio_stream::Stream;

pub(super) const SHUTDOWN_DRAIN_ENV: &str = "COSYWORLD_SHUTDOWN_DRAIN_MS";
const DEFAULT_SHUTDOWN_DRAIN_MS: u64 = 3_000;
const MIN_SHUTDOWN_DRAIN_MS: u64 = 100;
const MAX_SHUTDOWN_DRAIN_MS: u64 = 4_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum ShutdownReason {
    #[default]
    None,
    Sigint,
    Sigterm,
    #[cfg(test)]
    Test,
}

impl ShutdownReason {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Sigint => "sigint",
            Self::Sigterm => "sigterm",
            #[cfg(test)]
            Self::Test => "test",
        }
    }
}

impl fmt::Display for ShutdownReason {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct ShutdownNotice {
    pub(super) sequence: u64,
    pub(super) reason: ShutdownReason,
}

#[derive(Default)]
struct ShutdownMetrics {
    signals: AtomicU64,
    active_streams: AtomicU64,
    active_streams_at_first_signal: AtomicU64,
    streams_notified: AtomicU64,
}

#[derive(Clone)]
pub(super) struct ShutdownTrigger {
    sender: Arc<watch::Sender<ShutdownNotice>>,
    metrics: Arc<ShutdownMetrics>,
}

#[derive(Clone)]
pub(super) struct ShutdownSubscription {
    receiver: watch::Receiver<ShutdownNotice>,
    // Keep the channel open for routers constructed outside the production
    // signal lifecycle, including focused handler tests.
    _sender: Arc<watch::Sender<ShutdownNotice>>,
    metrics: Arc<ShutdownMetrics>,
}

pub(super) fn shutdown_channel() -> (ShutdownTrigger, ShutdownSubscription) {
    let (sender, receiver) = watch::channel(ShutdownNotice::default());
    let sender = Arc::new(sender);
    let metrics = Arc::new(ShutdownMetrics::default());
    (
        ShutdownTrigger {
            sender: Arc::clone(&sender),
            metrics: Arc::clone(&metrics),
        },
        ShutdownSubscription {
            receiver,
            _sender: sender,
            metrics,
        },
    )
}

impl ShutdownTrigger {
    pub(super) fn notify(&self, reason: ShutdownReason) -> ShutdownNotice {
        let prior_signal_count = self.metrics.signals.fetch_add(1, Ordering::AcqRel);
        if prior_signal_count == 0 {
            // Capture before publishing the notice: awakened SSE tasks can
            // otherwise finish and decrement the active count first.
            self.metrics.active_streams_at_first_signal.store(
                self.metrics.active_streams.load(Ordering::Acquire),
                Ordering::Release,
            );
        }
        let mut emitted = ShutdownNotice::default();
        self.sender.send_modify(|notice| {
            notice.sequence = notice.sequence.saturating_add(1);
            notice.reason = reason;
            emitted = *notice;
        });
        emitted
    }
}

impl ShutdownSubscription {
    #[cfg(test)]
    pub(super) fn idle() -> Self {
        shutdown_channel().1
    }

    pub(super) fn is_draining(&self) -> bool {
        self.receiver.borrow().sequence > 0
    }

    pub(super) async fn wait_after(&mut self, sequence: u64) -> ShutdownNotice {
        loop {
            let notice = *self.receiver.borrow_and_update();
            if notice.sequence > sequence {
                return notice;
            }
            if self.receiver.changed().await.is_err() {
                std::future::pending::<()>().await;
            }
        }
    }

    pub(super) fn active_streams(&self) -> u64 {
        self.metrics.active_streams.load(Ordering::Acquire)
    }

    pub(super) fn active_streams_at_first_signal(&self) -> u64 {
        self.metrics
            .active_streams_at_first_signal
            .load(Ordering::Acquire)
    }

    pub(super) fn streams_notified(&self) -> u64 {
        self.metrics.streams_notified.load(Ordering::Acquire)
    }

    pub(super) fn signal_count(&self) -> u64 {
        self.metrics.signals.load(Ordering::Acquire)
    }

    pub(super) fn finish_stream<S>(self, stream: S) -> impl Stream<Item = S::Item>
    where
        S: Stream,
    {
        let mut subscription = self;
        let mut guard = ShutdownStreamGuard::new(Arc::clone(&subscription.metrics));
        stream.take_until(async move {
            subscription.wait_after(0).await;
            guard.mark_notified();
        })
    }
}

struct ShutdownStreamGuard {
    metrics: Arc<ShutdownMetrics>,
    notified: bool,
}

impl ShutdownStreamGuard {
    fn new(metrics: Arc<ShutdownMetrics>) -> Self {
        metrics.active_streams.fetch_add(1, Ordering::AcqRel);
        Self {
            metrics,
            notified: false,
        }
    }

    fn mark_notified(&mut self) {
        if !self.notified {
            self.metrics.streams_notified.fetch_add(1, Ordering::AcqRel);
            self.notified = true;
        }
    }
}

impl Drop for ShutdownStreamGuard {
    fn drop(&mut self) {
        self.metrics.active_streams.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(super) fn configured_shutdown_drain_budget() -> io::Result<Duration> {
    let configured = match std::env::var(SHUTDOWN_DRAIN_ENV) {
        Ok(value) => value.trim().parse::<u64>().map_err(|_| {
            deployment_config_error(format!(
                "{SHUTDOWN_DRAIN_ENV} must be an integer number of milliseconds"
            ))
        })?,
        Err(std::env::VarError::NotPresent) => DEFAULT_SHUTDOWN_DRAIN_MS,
        Err(error) => return Err(deployment_config_error(error.to_string())),
    };
    if !(MIN_SHUTDOWN_DRAIN_MS..=MAX_SHUTDOWN_DRAIN_MS).contains(&configured) {
        return Err(deployment_config_error(format!(
            "{SHUTDOWN_DRAIN_ENV} must be between {MIN_SHUTDOWN_DRAIN_MS} and {MAX_SHUTDOWN_DRAIN_MS} milliseconds so shutdown finishes before Fly escalates"
        )));
    }
    Ok(Duration::from_millis(configured))
}

pub(super) async fn relay_shutdown_signals(trigger: ShutdownTrigger, include_sigint: bool) {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal as unix_signal, SignalKind};

        let mut terminate = match unix_signal(SignalKind::terminate()) {
            Ok(signal) => signal,
            Err(error) => {
                error!(event = "shutdown_signal_install_failed", signal = "sigterm", %error);
                return;
            }
        };
        let mut interrupt = if include_sigint {
            match unix_signal(SignalKind::interrupt()) {
                Ok(signal) => Some(signal),
                Err(error) => {
                    error!(event = "shutdown_signal_install_failed", signal = "sigint", %error);
                    return;
                }
            }
        } else {
            None
        };

        loop {
            let reason = match interrupt.as_mut() {
                Some(interrupt) => tokio::select! {
                    signal = interrupt.recv() => {
                        if signal.is_none() { return; }
                        ShutdownReason::Sigint
                    }
                    signal = terminate.recv() => {
                        if signal.is_none() { return; }
                        ShutdownReason::Sigterm
                    }
                },
                None => {
                    if terminate.recv().await.is_none() {
                        return;
                    }
                    ShutdownReason::Sigterm
                }
            };
            let notice = trigger.notify(reason);
            if notice.sequence == 1 {
                info!(
                    event = "shutdown_signal_received",
                    signal = reason.as_str(),
                    signal_count = notice.sequence
                );
            } else {
                warn!(
                    event = "shutdown_signal_repeated",
                    signal = reason.as_str(),
                    signal_count = notice.sequence
                );
            }
        }
    }

    #[cfg(not(unix))]
    {
        if !include_sigint {
            std::future::pending::<()>().await;
        }
        loop {
            if let Err(error) = tokio::signal::ctrl_c().await {
                error!(event = "shutdown_signal_install_failed", signal = "ctrl_c", %error);
                return;
            }
            let notice = trigger.notify(ShutdownReason::Sigint);
            info!(
                event = "shutdown_signal_received",
                signal = ShutdownReason::Sigint.as_str(),
                signal_count = notice.sequence
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn repeated_notices_are_ordered_and_observable() {
        let (trigger, mut subscription) = shutdown_channel();
        assert!(!subscription.is_draining());
        let first = trigger.notify(ShutdownReason::Sigint);
        assert_eq!(subscription.wait_after(0).await, first);
        let second = trigger.notify(ShutdownReason::Sigterm);
        assert_eq!(subscription.wait_after(first.sequence).await, second);
        assert_eq!(subscription.signal_count(), 2);
    }
}
