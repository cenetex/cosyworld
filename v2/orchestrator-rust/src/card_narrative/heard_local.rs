//! The host sizes prompts while the game keeps its original four-stanza page.
use super::*;
use std::future::Future;

const INPUT_TOKENS: usize = 1408;
#[cfg(feature = "embedded-llama")]
const OUTPUT_TOKENS: u32 = 192;

struct Prompt {
    system: String,
    user: String,
}

fn compact(context: &Context, entity: &Entity, from: usize, to: usize) -> String {
    let poem = entity.poem.as_ref().expect("heard page");
    let header = heard::prompt(poem).expect("heard page").remove(0);
    let mut lines = vec![
        format!("Current scene: {}.", name(&context.location)),
        context.action.clone().unwrap_or_default(),
        header,
    ];
    lines.extend(knowledge::directions(context, &entity.id));
    lines.extend(
        poem.stanzas[from..to]
            .iter()
            .map(|s| format!("{}: {}", s.author_name, s.lines.join(" "))),
    );
    lines.push(cue(&name(&entity.id), Part::Line));
    lines.join("\n")
}

async fn plan<F, Fut>(
    context: &Context,
    entity: &Entity,
    system: &str,
    mut count: F,
) -> Result<Vec<Prompt>, ()>
where
    F: FnMut(String, String) -> Fut,
    Fut: Future<Output = Result<usize, ()>>,
{
    let full = attempt_transcript(context, entity, Part::Line, 0);
    if count(system.into(), full.clone()).await? <= INPUT_TOKENS {
        return Ok(vec![Prompt {
            system: system.into(),
            user: full,
        }]);
    }
    let stanzas = entity.poem.as_ref().ok_or(())?.stanzas.len();
    let user = compact(context, entity, 0, stanzas);
    if count(system.into(), user.clone()).await? <= INPUT_TOKENS {
        return Ok(vec![Prompt {
            system: system.into(),
            user,
        }]);
    }
    let profile = &profiles()[&entity.id];
    let brief = format!(
        "I am {}.\n{}\n{}",
        name(&entity.id),
        profile["persona"]
            .as_str()
            .unwrap_or_default()
            .split_inclusive('.')
            .next()
            .unwrap_or_default(),
        expression::direction(expression::mode(profile), &name(&entity.id))
    );
    if count(brief.clone(), user.clone()).await? <= INPUT_TOKENS {
        return Ok(vec![Prompt {
            system: brief,
            user,
        }]);
    }
    let mut prompts = Vec::new();
    let mut from = 0;
    while from < stanzas {
        let mut selected = None;
        for to in from + 1..=stanzas {
            let user = compact(context, entity, from, to);
            if count(brief.clone(), user.clone()).await? > INPUT_TOKENS {
                break;
            }
            selected = Some((to, user));
        }
        let (to, user) = selected.ok_or(())?;
        prompts.push(Prompt {
            system: brief.clone(),
            user,
        });
        from = to;
    }
    if prompts.is_empty() {
        return Err(());
    }
    Ok(prompts)
}

#[cfg(feature = "embedded-llama")]
pub(super) async fn speak(
    config: &AiConfig,
    context: &Context,
    entity: &Entity,
    settings: &VoiceSettings,
    deadline: tokio::time::Instant,
    system: &str,
) -> Result<(String, String), ()> {
    let prompts = plan(context, entity, system, |system, user| async move {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(());
        }
        crate::ai_gateway::llama::count_tokens(&system, &user, remaining.min(settings.call_timeout))
            .await
            .map_err(|_| ())
    })
    .await?;
    let mut replies = Vec::new();
    let mut model = String::new();
    for prompt in &prompts {
        let mut check = Check::new(context, entity, Part::Line);
        check.limit = settings.line_limit;
        let (text, used) = voice_attempts(settings, deadline, false, |_, attempt, timeout| {
            let check = &check;
            async move {
                let result = request_chat_completion(
                    config,
                    ChatCompletionRequest {
                        feature: "card_voice",
                        prompt_version: "heard-page-v1",
                        capability: ModelCapability::WorldContent,
                        system: &prompt.system,
                        user: &prompt.user,
                        temperature: 1.0 - 0.1 * f64::from(attempt),
                        max_tokens: OUTPUT_TOKENS,
                        timeout,
                        max_attempts: 1,
                        referer: "https://cosyworld.fly.dev",
                        response_format: None,
                        room_id: None,
                    },
                )
                .await
                .map_err(|_| ())?;
                let text = check
                    .clean(
                        &result.text,
                        matches!(result.finish_reason.as_str(), "stop" | "end_turn"),
                    )
                    .map_err(|_| ())?;
                Ok((text, result.resolved_model_id))
            }
        })
        .await?;
        replies.push(text);
        model = used;
    }
    let mut check = Check::new(context, entity, Part::Line);
    check.limit = settings.line_limit;
    check.sentences = prompts.len().saturating_mul(2);
    let text = check.clean(&replies.join(" "), true).map_err(|_| ())?;
    tracing::info!(
        feature = "card_voice",
        host_parts = prompts.len(),
        input_limit = INPUT_TOKENS,
        output_limit = OUTPUT_TOKENS,
        "Heard page reply ready"
    );
    Ok((text, model))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn splits_host_input_and_retains_the_original_reading_page() {
        let mut context: Context = serde_json::from_str(include_str!(
            "../../../../test/fixtures/card-heard-page-context.json"
        ))
        .unwrap();
        let entity = context
            .entities
            .iter_mut()
            .find(|e| e.id == "greek-viii-aeschylus")
            .unwrap();
        for stanza in &mut entity.poem.as_mut().unwrap().stanzas {
            stanza.lines = vec!["L".repeat(90), "R".repeat(90)];
        }
        let entity = context
            .entities
            .iter()
            .find(|e| e.id == "greek-viii-aeschylus")
            .unwrap();
        let original = serde_json::to_value(&entity.poem).unwrap();
        let prompts = plan(&context, entity, "A voice.", |_, user| async move {
            Ok(100 + user.matches(&"L".repeat(90)).count() * 420)
        })
        .await
        .unwrap();
        assert_eq!(prompts.len(), 2);
        assert_eq!(
            prompts
                .iter()
                .map(|p| p.user.matches(&"L".repeat(90)).count())
                .sum::<usize>(),
            4
        );
        assert!(prompts
            .iter()
            .all(|p| !p.system.is_empty() && p.user.contains("turn")));
        assert_eq!(serde_json::to_value(&entity.poem).unwrap(), original);
    }
}
