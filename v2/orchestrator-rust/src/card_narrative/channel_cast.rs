use super::{forest_data, pack, packs, shared_cast, Resident, DEFAULT_PACK};
use cosyworld_orchestrator::card_assets;
use serde_json::Value;
use std::sync::OnceLock;

pub(super) const TALKED: usize = 8;
const FLOOR: usize = 3;
pub(super) const LISTENER: &str = "listener";

pub(super) fn face_avatar(portrait: &str) -> Option<String> {
    static FACES: OnceLock<Value> = OnceLock::new();
    let faces = FACES.get_or_init(|| {
        serde_json::from_str(card_assets::text("card-game/assets/discord-faces.json"))
            .expect("embedded discord face boxes")
    });
    faces.get(portrait)?;
    let (dir, file) = portrait.rsplit_once('/')?;
    let pack_dir = dir.rsplit('/').next()?;
    let stem = file.rsplit_once('.').map_or(file, |(stem, _)| stem);
    Some(format!("/card-game/assets/faces/{pack_dir}-{stem}.webp"))
}

pub(super) const CORE: [(&str, &str); 3] =
    [("vale", "Vale"), ("moth", "Pip"), ("keeper", "Keeper")];

fn core() -> Vec<Resident> {
    let forest = forest_data();
    CORE.iter()
        .filter_map(|(id, name)| {
            let portrait = format!("assets/{id}.png");
            Some(Resident {
                id: (*id).to_string(),
                name: (*name).to_string(),
                place: forest["people"][*id]["home"].as_str()?.to_string(),
                avatar: face_avatar(&portrait),
                portrait: format!("/card-game/{portrait}"),
            })
        })
        .collect()
}

fn member(id: &str, avatar: &Value) -> Option<Resident> {
    let portrait = avatar["portrait"]
        .as_str()
        .or_else(|| avatar["variants"]["awake"]["portrait"].as_str())
        .map_or_else(|| format!("assets/{id}.png"), str::to_string);
    Some(Resident {
        id: id.to_string(),
        name: avatar["name"].as_str().unwrap_or(id).to_string(),
        place: avatar["place"].as_str()?.to_string(),
        avatar: face_avatar(&portrait),
        portrait: format!("/card-game/{portrait}"),
    })
}

pub(super) fn cast(pack_id: &str) -> Option<Vec<Resident>> {
    let mut residents: Vec<Resident> = pack(pack_id)?["avatars"]
        .as_object()?
        .iter()
        .filter_map(|(id, avatar)| member(id, avatar))
        .collect();
    if pack_id == DEFAULT_PACK {
        residents.extend(core());
    }
    (!residents.is_empty()).then_some(residents)
}

pub(super) async fn chosen_names(app: Option<&crate::AppState>, residents: &mut [Resident]) {
    let Some(state) = app else { return };
    for resident in residents.iter_mut() {
        if let Some(name) =
            crate::card_shared::elysium_name(state, &resident.id, &resident.place, false).await
        {
            resident.name = name;
        }
    }
}

fn avatar_card(id: &str) -> Option<&'static Value> {
    let all = packs()["packs"].as_array()?;
    all.iter().find_map(|p| p["avatars"].get(id))
}

fn traveler(id: &str) -> Option<&'static Value> {
    let all = shared_cast()["avatars"].as_array()?;
    all.iter().find(|human| human["id"] == id)
}

pub(super) fn resident(id: &str) -> Option<Resident> {
    if id == LISTENER {
        return member(id, &forest_data()["people"][id]);
    }
    if let Some(found) = avatar_card(id).and_then(|avatar| member(id, avatar)) {
        return Some(found);
    }
    if let Some(found) = core().into_iter().find(|r| r.id == id) {
        return Some(found);
    }
    let human = traveler(id)?;
    let portrait = format!("assets/shared/characters/{id}.png");
    Some(Resident {
        id: id.to_string(),
        name: human["name"].as_str()?.to_string(),
        place: human["home"]["id"].as_str()?.to_string(),
        avatar: face_avatar(&portrait),
        portrait: format!("/card-game/{portrait}"),
    })
}

pub(super) fn recent(fixed: Vec<Resident>, talked: &[String]) -> Vec<Resident> {
    let mut residents: Vec<Resident> = talked
        .iter()
        .filter_map(|id| resident(id))
        .take(TALKED)
        .collect();
    if residents.len() < FLOOR {
        for found in fixed {
            if residents.len() < TALKED && !residents.iter().any(|r| r.id == found.id) {
                residents.push(found);
            }
        }
    }
    residents
}

pub(super) async fn guild_talked(guild: Option<String>) -> Option<Vec<String>> {
    let guild = guild?;
    let read = move || crate::card_shared::guild_talked(&guild);
    tokio::task::spawn_blocking(read).await.ok().flatten()
}

pub(super) fn knows_listener(talked: &[String]) -> bool {
    talked.iter().any(|id| id == LISTENER)
}

pub(super) async fn room_cast(
    pack_id: &str,
    guild: Option<String>,
) -> Option<(Vec<Resident>, bool)> {
    let fixed = cast(pack_id)?;
    Some(match guild_talked(guild).await {
        Some(talked) => (recent(fixed, &talked), knows_listener(&talked)),
        None => (fixed, false),
    })
}

pub(super) fn joined(
    mut cast: Vec<Resident>,
    ids: impl IntoIterator<Item = String>,
    listener_known: bool,
) -> Vec<Resident> {
    for id in ids {
        if (listener_known || id != LISTENER) && !cast.iter().any(|r| r.id == id) {
            cast.extend(resident(&id));
        }
    }
    cast
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_guild_encounter_resolves_the_listener_without_changing_the_roster_limit() {
        let fixed = cast("lonely-forest").unwrap();
        let has_listener = |cast: &[Resident]| cast.iter().any(|r| r.id == LISTENER);
        assert!(!has_listener(&recent(fixed.clone(), &[])));
        assert!(!has_listener(&joined(
            fixed.clone(),
            [LISTENER.into()],
            false
        )));
        let spoken = ["vale".into(), LISTENER.into()];
        let roster = recent(fixed.clone(), &spoken);
        let listener = &roster[1];
        assert_eq!(listener.id, LISTENER);
        assert_eq!(listener.name, "The Listener");
        assert_eq!(
            listener.portrait,
            "/card-game/assets/listener/listener.webp"
        );
        assert!(has_listener(&joined(
            fixed.clone(),
            [LISTENER.into()],
            true
        )));

        let mut talks: Vec<String> = pack("greek-drama").unwrap()["avatars"]
            .as_object()
            .unwrap()
            .keys()
            .take(TALKED)
            .cloned()
            .collect();
        talks.insert(1, LISTENER.into());
        let ids = |roster: Vec<Resident>| roster.into_iter().map(|r| r.id).collect::<Vec<_>>();
        assert_eq!(ids(recent(fixed.clone(), &talks)), talks[..TALKED]);
        talks.rotate_left(2);
        let capped = recent(fixed, &talks);
        assert!(!has_listener(&capped));
        assert_eq!(ids(capped), talks[..TALKED]);
    }
}
