use super::{cast, resident, Resident};

pub(super) const TALKED: usize = 8;
const FLOOR: usize = 3;
pub(super) const LISTENER: &str = "listener";

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
    use super::{super::pack, *};

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
