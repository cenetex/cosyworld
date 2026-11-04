//! The voice's fallback chain (owner, 2026-11-04: characters can be any
//! model, with fallbacks). A part tries its own model, then each fallback in
//! order, inside its one scene deadline.
use super::VoiceSettings;
use std::time::Duration;

/// Why an attempt gave no line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Miss {
    /// The validator blocked the reply; the model may try again.
    Blocked,
    /// A provider error (a 5xx among them) or an empty reply.
    Failed,
}

impl Miss {
    pub(super) fn of(reason: &str) -> Self {
        match reason {
            "empty" => Self::Failed,
            _ => Self::Blocked,
        }
    }
}

/// Run a chain of `links` models inside the scene deadline. Each model's
/// share is the time that remains over the models still to try. A failure or
/// a timeout moves on at once, and blocked replies after the voice's
/// attempts. A lone model keeps every attempt, as it did before the chain.
/// `request` gets the link, the part's attempt number and its time budget.
pub(super) async fn run<T, F, Fut>(
    settings: &VoiceSettings,
    deadline: tokio::time::Instant,
    links: usize,
    mut request: F,
) -> Result<T, ()>
where
    F: FnMut(usize, u8, Duration) -> Fut,
    Fut: std::future::Future<Output = Result<T, Miss>>,
{
    let mut attempt = 0u8;
    for link in 0..links {
        let start = tokio::time::Instant::now();
        let share = deadline.saturating_duration_since(start) / (links - link) as u32;
        let until = if link + 1 == links {
            deadline
        } else {
            start + share
        };
        for _ in 0..settings.attempts.max(1) {
            let now = tokio::time::Instant::now();
            let budget = until
                .saturating_duration_since(now)
                .min(settings.call_timeout);
            if budget.is_zero() {
                break;
            }
            let result =
                tokio::time::timeout_at(now + budget, request(link, attempt, budget)).await;
            attempt = attempt.saturating_add(1);
            match result {
                Ok(Ok(spoken)) => return Ok(spoken),
                Ok(Err(Miss::Blocked)) => {}
                _ if links == 1 => {}
                _ => break,
            }
        }
    }
    Err(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn each_failure_moves_on_and_blocked_replies_move_on_after_the_attempts() {
        let settings = VoiceSettings::hosted();
        let deadline = tokio::time::Instant::now() + settings.scene_timeout;
        let mut seen = Vec::new();
        let result = run(&settings, deadline, 4, |link, attempt, _| {
            seen.push((link, attempt));
            async move {
                match link {
                    0 => Err(Miss::Failed),
                    1 => std::future::pending().await,
                    2 => Err(Miss::Blocked),
                    _ => Ok(link),
                }
            }
        })
        .await;
        assert_eq!(result, Ok(3));
        assert_eq!(seen, [(0, 0), (1, 1), (2, 2), (2, 3), (3, 4)]);
    }
}
