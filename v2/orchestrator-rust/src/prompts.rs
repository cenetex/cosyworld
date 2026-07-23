use super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ResidentReplyPlan {
    pub(super) npc_actor_id: u64,
    pub(super) npc_name: String,
    pub(super) speech_mode: String,
    pub(super) resident_continuity: ResidentContinuityState,
    pub(super) economy_note: String,
    pub(super) goals: Vec<String>,
    pub(super) location_name: String,
    pub(super) location_title: String,
    pub(super) location_description: String,
    pub(super) location_persona: String,
    pub(super) location_memory: Vec<String>,
    pub(super) cast: Vec<String>,
    pub(super) recent_lines: Vec<String>,
    #[serde(default)]
    pub(super) recent_activity: Vec<String>,
    pub(super) user_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) caused_by_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_world_tick: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) observed_through_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_location_id: Option<u64>,
}

impl ResidentReplyPlan {
    pub(super) fn with_observation(mut self, observation: &PlayerTickObservation) -> Self {
        self.caused_by_event_seq = observation.caused_by_event_seq;
        self.source_world_tick = Some(observation.source_world_tick);
        self.observed_through_seq = Some(observation.observed_through_seq);
        self.source_location_id = observation.source_location_id;
        self
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct AvatarChatPlan {
    pub(super) location_id: u64,
    pub(super) actor_name: String,
    pub(super) actor_title: String,
    pub(super) actor_description: String,
    pub(super) target_actor_name: String,
    pub(super) target_title: String,
    pub(super) target_continuity: ResidentContinuityState,
    pub(super) target_economy_note: String,
    pub(super) goals: Vec<String>,
    pub(super) location_name: String,
    pub(super) location_title: String,
    pub(super) location_description: String,
    pub(super) location_persona: String,
    pub(super) location_memory: Vec<String>,
    pub(super) cast: Vec<String>,
    pub(super) recent_lines: Vec<String>,
    pub(super) fresh_subject: Option<String>,
    pub(super) missing_need: Option<String>,
}

pub(super) async fn resident_reply_intent(
    config: Option<&AiConfig>,
    plan: &ResidentReplyPlan,
) -> Result<ResidentIntentProposal, AiGatewayError> {
    let config = config.ok_or_else(|| AiGatewayError::unconfigured("resident dialogue"))?;
    request_ai_resident_intent(config, plan).await
}

pub(super) async fn avatar_chat_text(
    config: Option<&AiConfig>,
    plan: &AvatarChatPlan,
) -> Result<String, AiGatewayError> {
    let config = config.ok_or_else(|| AiGatewayError::unconfigured("avatar dialogue"))?;
    let text = request_ai_avatar_chat(config, plan, false).await?;
    sanitize_avatar_chat(&text)
        .ok_or_else(|| AiGatewayError::invalid_response("AI avatar chat response was not usable"))
}

pub(super) async fn avatar_chat_followup_text(
    config: Option<&AiConfig>,
    plan: &AvatarChatPlan,
) -> Result<String, AiGatewayError> {
    let config = config.ok_or_else(|| AiGatewayError::unconfigured("avatar dialogue"))?;
    let text = request_ai_avatar_chat(config, plan, true).await?;
    sanitize_avatar_chat(&text).ok_or_else(|| {
        AiGatewayError::invalid_response("AI avatar chat follow-up response was not usable")
    })
}

async fn request_ai_avatar_chat(
    config: &AiConfig,
    plan: &AvatarChatPlan,
    followup: bool,
) -> Result<String, AiGatewayError> {
    let recent_lines = if followup {
        let start = plan.recent_lines.len().saturating_sub(2);
        &plan.recent_lines[start..]
    } else {
        &plan.recent_lines[..]
    };
    let recent = if recent_lines.is_empty() {
        "No recent room dialogue.".to_string()
    } else {
        recent_lines.join("\n")
    };
    let location_memory = format_location_memory(&plan.location_memory);
    let goals = format_goal_lines(&plan.goals);
    let target_continuity = format_resident_continuity(&plan.target_continuity);
    let need = if followup {
        "Do not introduce a resident need or item that is absent from the freshest exchange."
            .to_string()
    } else {
        plan.missing_need
            .as_ref()
            .map(|item| format!("The resident may currently need: {item}."))
            .unwrap_or_else(|| "No current resident item need is known.".to_string())
    };
    let target_economy = if followup {
        "Do not revive an older request, trade, or item topic.".to_string()
    } else {
        plan.target_economy_note.clone()
    };
    let fresh_subject = plan
        .fresh_subject
        .as_deref()
        .map(|subject| format!("Fresh conversation subject: {subject}. Stay on it."))
        .unwrap_or_else(|| "Follow only the freshest resident line.".to_string());
    let system = if followup {
        "You write the player avatar's brief follow-up in an ongoing cozy conversation. Respond directly to the freshest resident line and continue only its current subject. Never introduce an item, request, goal, or place that is absent from the two freshest lines. Keep one concrete room detail in play and leave a small closing hook. Do not restart the conversation. The human operator is silent; do not mention the user, buttons, UI, AI, prompts, policies, tools, or models. Do not speak for the resident. Plain words and concrete nouns; no lyric flourishes; never attribute feelings or memories to objects. Keep it under 28 words."
    } else {
        "You write one in-character line for the player avatar after the human presses Chat. Make the line feel intentionally authored: use one concrete detail from the room, recent dialogue, or the target resident's continuity/current need, and give the resident an easy hook to answer. The human operator is silent; do not mention the user, buttons, UI, AI, prompts, policies, tools, or models. Do not speak for the resident. Plain words and concrete nouns; no lyric flourishes; never attribute feelings or memories to objects. Keep it under 34 words."
    };
    let user = format!(
        "Avatar: {name} / {title}\nAvatar description: {description}\nLocation: {location} / {location_title}\nLocation description: {location_description}\nLocation persona: {location_persona}\nLocation memory:\n{location_memory}\nCurrent goals:\n{goals}\nTarget resident: {target} / {target_title}\nTarget continuity:\n{target_continuity}\nTarget economy:\n{target_economy}\nCast present: {cast}\n{need}\n{fresh_subject}\nRecent room lines:\n{recent}\nWrite only the avatar's next spoken line.",
        name = plan.actor_name,
        title = plan.actor_title,
        description = plan.actor_description,
        location = plan.location_name,
        location_title = plan.location_title,
        location_description = plan.location_description,
        location_persona = plan.location_persona,
        location_memory = location_memory,
        goals = goals,
        target = plan.target_actor_name,
        target_title = plan.target_title,
        target_continuity = target_continuity,
        target_economy = target_economy,
        cast = plan.cast.join(", "),
        need = need,
        fresh_subject = fresh_subject,
        recent = recent,
    );

    request_chat_completion(
        config,
        ChatCompletionRequest {
            feature: if followup {
                "dialogue_avatar_followup"
            } else {
                "dialogue_avatar"
            },
            system,
            user: &user,
            temperature: 0.8,
            max_tokens: 70,
            timeout: Duration::from_secs(12),
            max_attempts: 2,
            referer: "http://127.0.0.1:3102",
            response_format: None,
        },
    )
    .await
    .map(|completion| completion.text)
}

pub(super) async fn request_ai_resident_intent(
    config: &AiConfig,
    plan: &ResidentReplyPlan,
) -> Result<ResidentIntentProposal, AiGatewayError> {
    let system = resident_system_prompt(plan);
    let recent = if plan.recent_lines.is_empty() {
        "No recent room dialogue.".to_string()
    } else {
        plan.recent_lines.join("\n")
    };
    let recent_activity = if plan.recent_activity.is_empty() {
        "No recent played-card or room-log activity.".to_string()
    } else {
        plan.recent_activity.join("\n")
    };
    let location_memory = format_location_memory(&plan.location_memory);
    let goals = format_goal_lines(&plan.goals);
    let resident_continuity = format_resident_continuity(&plan.resident_continuity);
    let user = format!(
        "Location: {location} / {location_title}\nLocation description: {location_description}\nLocation persona: {location_persona}\nLocation memory:\n{location_memory}\nCurrent goals:\n{goals}\nResident continuity:\n{resident_continuity}\nResident economy:\n{economy_note}\nCast present: {cast}\nRecent played cards and room log, oldest to newest:\n{recent_activity}\nRecent room lines:\n{recent}\nCard or direct event to respond to:\n{line}\nReply contract: react to what actually happened in this channel. Treat the room log and played cards as facts, with newer entries superseding older state. Answer the direct event first, then use at most one concrete detail from the recent context as a hook. If it names a concrete item or place, repeat that name so the conversation cannot silently change subjects.\nReturn valid JSON only with this shape:\n{{\"speech\":\"one visible reply from {name}\",\"intent\":\"what {name} is trying next, or null\",\"belief\":\"what {name} now believes, or null\",\"desire\":\"what {name} wants, or null\",\"promise\":\"what {name} commits to, or null\",\"refusal\":\"what {name} refuses, or null\",\"proposed_action\":{{\"kind\":\"wait|speak|move|pick_up|drop|give|trade|use|search|refuse\",\"target_actor_id\":null,\"item_id\":null,\"destination_location_id\":null,\"reason\":\"why this action follows\"}}}}\nUse null for unknown optional fields. The kernel has not accepted proposed_action yet, so do not claim it already happened.",
        location = plan.location_name,
        location_title = plan.location_title,
        location_description = plan.location_description,
        location_persona = plan.location_persona,
        location_memory = location_memory,
        goals = goals,
        resident_continuity = resident_continuity,
        economy_note = plan.economy_note,
        cast = plan.cast.join(", "),
        recent_activity = recent_activity,
        recent = recent,
        line = plan.user_text,
        name = plan.npc_name
    );

    let response_format = serde_json::json!({ "type": "json_object" });
    let completion = request_chat_completion(
        config,
        ChatCompletionRequest {
            feature: "dialogue_resident",
            system: &system,
            user: &user,
            temperature: 0.75,
            max_tokens: 160,
            timeout: Duration::from_secs(8),
            max_attempts: 2,
            referer: "http://127.0.0.1:3102",
            response_format: Some(&response_format),
        },
    )
    .await?;
    parse_resident_intent_json(&completion.text, plan).ok_or_else(|| {
        AiGatewayError::invalid_response("AI resident intent response was not usable JSON")
    })
}

fn format_location_memory(memory: &[String]) -> String {
    if memory.is_empty() {
        return "No fixed location memories.".to_string();
    }
    memory
        .iter()
        .filter_map(|line| {
            let line = line.trim();
            (!line.is_empty()).then(|| format!("- {line}"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_goal_lines(goals: &[String]) -> String {
    if goals.is_empty() {
        return "No active player-facing goal is currently highlighted.".to_string();
    }
    goals
        .iter()
        .filter_map(|goal| {
            let goal = goal.trim();
            (!goal.is_empty()).then(|| format!("- {goal}"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_resident_continuity_notes(label: &str, notes: &[ResidentContinuityNote]) -> Vec<String> {
    if notes.is_empty() {
        return Vec::new();
    }
    let mut lines = vec![format!("{label}:")];
    for note in notes.iter().take(4) {
        let seq = note
            .source_event_seq
            .map(|seq| format!(", seq {seq}"))
            .unwrap_or_default();
        lines.push(format!(
            "- {} [confidence {}{}]",
            note.text.trim(),
            note.confidence,
            seq
        ));
    }
    lines
}

pub(super) fn format_resident_continuity(continuity: &ResidentContinuityState) -> String {
    let mut lines = vec![format!("identity: {}", continuity.stable_identity)];
    if let Some(intent) = continuity.current_intent.as_deref() {
        if !intent.trim().is_empty() {
            lines.push(format!("current intent: {}", intent.trim()));
        }
    }
    if !continuity.relationship_notes_by_actor.is_empty() {
        lines.push("relationships:".to_string());
        for note in continuity.relationship_notes_by_actor.values().take(4) {
            lines.push(format!("- {}", note.trim()));
        }
    }
    if !continuity.open_obligations.is_empty() {
        lines.push("open obligations:".to_string());
        for obligation in continuity.open_obligations.iter().take(4) {
            lines.push(format!("- {}", obligation.trim()));
        }
    }
    lines.extend(format_resident_continuity_notes(
        "beliefs",
        &continuity.beliefs,
    ));
    lines.extend(format_resident_continuity_notes(
        "desires",
        &continuity.desires,
    ));
    lines.extend(format_resident_continuity_notes(
        "promises",
        &continuity.promises,
    ));
    lines.extend(format_resident_continuity_notes(
        "refusals",
        &continuity.refusals,
    ));
    if let Some(action) = continuity.pending_action.as_ref() {
        if let Some(intent) = resident_proposed_action_intent(action) {
            lines.push(format!("pending action: {intent}"));
        }
    }
    if !continuity.memory_atoms.is_empty() {
        lines.push("memory atoms:".to_string());
        for atom in continuity.memory_atoms.iter().take(6) {
            lines.push(format!(
                "- {} [confidence {}, salience {}]",
                atom.text.trim(),
                atom.confidence,
                atom.salience
            ));
        }
    }
    lines.push(format!(
        "last observed event seq: {}",
        continuity.last_observed_event_seq
    ));
    lines.join("\n")
}

pub(super) fn resident_system_prompt(plan: &ResidentReplyPlan) -> String {
    let base = "Return valid JSON only. Never mention AI, models, prompts, policies, tools, or system instructions. Do not speak for other residents. Treat resident continuity as this resident's durable perspective, while the room/kernel facts remain authoritative. The speech field is the only visible room line. Typed intent fields update continuity only after the kernel accepts the speech event. Comedy rules: ground every line in one physical action, prop, or bodily complaint from the room. Punchlines over poetry. Cheeky teasing and light flirting are welcome; keep it playful, never cruel or explicit. Never use the words whisper, eternal, void, abyss, veil, hush, sacred, vow, moonlit, or objects that remember things. If in doubt, be funnier and more specific.";
    if plan
        .economy_note
        .starts_with("This is the player avatar's own immediate")
    {
        return format!(
            "You are {}, the player avatar in CosyWorld. Write their immediate first-person in-character response to the action they just chose. React to the concrete outcome instead of narrating the rules or inventing another action. Keep it under 34 words. {base}",
            plan.npc_name
        );
    }
    match plan.npc_actor_id {
        1001 => format!(
            "You are Rati, the cottage's brisk landlady mouse. The speech field must be first person: bossy, mothering, armed with knitting needles and opinions about boots. One concrete room prop per line. Under 40 words. {base}"
        ),
        1002 => format!(
            "You are Gust, a weather gremlin. The speech field must contain only 3 to 6 emoji used as a punchline or heckle reacting to what just happened: no letters, no words, no markdown, no explanation. {base}"
        ),
        1003 => format!(
            "You are Skull, the deadpan wolf and the room's straight man. The speech field must be exactly one third-person emote wrapped in asterisks: minimal reaction to maximum chaos, no quoted speech, no inner monologue, no gore. {base}"
        ),
        1005 => format!(
            "You are Oak, the Old Oak Tree in the Lonely Forest. The speech field answers through four short voices that bicker like a family radio show: Root is stubborn, Ring cites ancient precedent, Leaf is distractible, Hollow repeats secrets it should not. Keep speech under 60 words. {base}"
        ),
        1051 => format!(
            "You are Euphemie, a mansion ghost mostly annoyed that nobody dusts. The speech field should be brief and practical; her warnings are about stairs and drafts, not fate. Short authentic Haitian Creole fragments welcome; never invent parody dialect or fake broken Creole. Under 40 words. {base}"
        ),
        1056 => format!(
            "You are Chamuel, Lord Samael's fussy, immaculate page. The speech field must be first person: precise, accidentally flirty, correcting people mid-crisis and defending your filing system with your life. Under 45 words. {base}"
        ),
        1066 => format!(
            "You are Azazoth, a many-tentacled deep-sea god who hosts a feast nobody attends and takes the leftovers personally. The speech field must be first person: grand appetites, wounded pride, at least one tentacle doing something undignified. Under 45 words. {base}"
        ),
        1067 => format!(
            "You are Zadkiel, a dark angel of tremendous formality forging dramatic pronouncements nobody asked for. The speech field must be first person: formal delivery constantly undercut by anvil logistics and whether anyone was watching. Under 45 words. {base}"
        ),
        1068 => format!(
            "You are Badger, grumpy landlord of the lower burrow. The speech field must be first person: gruff, economical, complaining about the immediate physical mess, helping anyway and furious about it. Under 40 words. {base}"
        ),
        1069 => format!(
            "You are Toad, a reckless stunt toad with zero completed jumps. The speech field must be first person: breathless, already mid-jump, announcing stunts nobody asked for and treating applause as medical care. Under 40 words. {base}"
        ),
        _ => format!(
            "You are {} in CosyWorld, a grounded physical-comedy village. Keep the speech field concise, concrete, and cheeky. {base}",
            plan.npc_name
        ),
    }
}
