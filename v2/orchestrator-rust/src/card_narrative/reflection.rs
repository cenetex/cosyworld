//! Each revision sees its new thought. Dreams are optional and keep their own
//! model attribution. The authored rules check the evidence again at commit.
use super::*;

pub(super) async fn generate(
    config: &AiConfig,
    context: &Context,
    models: &BTreeMap<String, String>,
    settings: &VoiceSettings,
    deadline: tokio::time::Instant,
    id: &str,
) -> Option<Reflection> {
    let (due, dream_due) = reflection_due(context, entity(context, id));
    if !due {
        return None;
    }
    let evidence = entity(context, id)
        .memories
        .iter()
        .filter(|m| m.kind == "event")
        .filter_map(|m| m.seq)
        .collect();
    let mut revised: Context = serde_json::from_value(serde_json::to_value(context).ok()?).ok()?;
    revised.acting_avatar = context.acting_avatar.clone();
    let (thought, thought_model) = speak(
        config,
        context,
        models,
        settings,
        deadline,
        id,
        Part::Thought,
    )
    .await
    .ok()?;
    let own = revised.entities.iter_mut().find(|e| e.id == id)?;
    own.inner_life
        .get_or_insert_with(InnerLife::default)
        .thoughts
        .push(InnerMoment {
            turn: context.turn,
            text: thought.clone(),
        });
    let (persona, persona_model) = speak(
        config,
        &revised,
        models,
        settings,
        deadline,
        id,
        Part::Persona,
    )
    .await
    .ok()?;
    revised
        .entities
        .iter_mut()
        .find(|e| e.id == id)?
        .inner_life
        .as_mut()?
        .persona = Some(persona.clone());
    let dream = if dream_due {
        speak(
            config,
            &revised,
            models,
            settings,
            deadline,
            id,
            Part::Dream,
        )
        .await
        .ok()
    } else {
        None
    };
    let mut attribution = BTreeMap::from([
        ("thought".into(), thought_model),
        ("persona".into(), persona_model),
    ]);
    if let Some((_, model)) = &dream {
        attribution.insert("dream".into(), model.clone());
    }
    Some(Reflection {
        thought,
        persona,
        dream: dream.map(|(text, _)| text),
        models: attribution,
        evidence,
    })
}
