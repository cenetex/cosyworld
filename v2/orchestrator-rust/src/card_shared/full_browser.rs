//! A signed-in player supplies speech for their own queued browser-funded play.
use super::*;
use crate::routes::card_game::narrative::browser::{self as voices, Answer};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct BrowserChat {
    key: String,
    answers: Option<Vec<Answer>>,
    #[serde(default)]
    failure: bool,
}
pub(super) async fn chat(
    State(state): State<AppState>,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(body): Json<BrowserChat>,
) -> Response {
    let result = blocking(move || {
        valid_id(&id)?;
        let u = user(&state, &h, true)?;
        admit(&u)?;
        let c = db(&state)?;
        store::schema(&c)?;
        let row: Option<(usize, String, String, i32)> = c.query_row(
            "SELECT actor,room,narrative,retries FROM card_full_plays WHERE world=? AND id=? AND user=? AND status='working' AND until_at>?",
            params![id, body.key, u, now()], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(sql_error)?;
        let (actor, room, text, attempt) = row.ok_or("Choose your current browser chat play.")?;
        if super::super::store::member(&c, &id, &u)? != Some(actor as i32) {
            return Err("Choose your claimed avatar.".into());
        }
        let context: Value = serde_json::from_str(&text).map_err(sql_error)?;
        if context["browser_chat"] != true { return Err("Choose a browser chat play.".into()); }
        let (payload, ids) = super::super::full_speech::prepared(actor, &context)?;
        if let Some(answers) = body.answers {
            let checked = voices::complete(&payload["scene"], Some(&ids), answers)?;
            let lines = super::super::full_speech::parse(&checked.to_string(), "stop", &context, actor, &ids)?;
            finish_work(&state, &id, Work { id:body.key, room, actor, context, attempt }, Ok(lines))?;
            Ok(json!({"ok":true}))
        } else if body.failure {
            finish_work(&state, &id, Work { id:body.key, room, actor, context, attempt }, Err("Connect OpenRouter in Settings, then retry this saved play.".into()))?;
            Ok(json!({"ok":true}))
        } else {
            voices::prepare(&payload["scene"], Some(&ids), state.ai_config.as_ref().as_ref())
        }
    }).await;
    reply(result)
}
