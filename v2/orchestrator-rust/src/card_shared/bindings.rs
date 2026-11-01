//! A person's passkey binds them to the avatar they take in a shared world
//! (#1825). The binding outlives Step away and Send to: they always return as
//! that avatar, and nobody else can claim it. The world's owner can free it
//! and the holder can release it; either starts it over as a fresh starter.
use super::store::{sql_error, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use sha2::{Digest, Sha256};

// The words of a holder's name, 64 of each. Frozen once released: changing or
// reordering them renames every holder.
const ADJECTIVES: &str =
    "Amber Ashen Autumn Birch Bramble Briar Bronze Candle Cedar Cinder Clover \
     Copper Coral Dappled Dawn Dusky Ember Fable Fennel Fern Frost Gentle Gilded \
     Glimmer Hazel Heather Hollow Honey Ivory Juniper Lantern Linen Maple Meadow \
     Mellow Misty Moss Nutmeg Oaken Pale Pebble Pine Plum Quiet Rain Rowan Russet \
     Saffron Sable Silver Slate Snowy Sorrel Starlit Still Sunny Thistle Tidal \
     Twilight Velvet Willow Winter Woolly Wren";
const NOUNS: &str =
    "Badger Beetle Bittern Bobcat Crane Cricket Crow Curlew Deer Dormouse Dove Eel \
     Elk Ferret Finch Fox Frog Gannet Goose Hare Hedgehog Heron Ibis Jay Kestrel \
     Kingfisher Lark Lynx Magpie Marten Mink Mole Moth Newt Nightjar Otter Owl \
     Pheasant Pika Plover Puffin Quail Rabbit Raven Robin Rook Salmon Seal Shrew \
     Skylark Snail Sparrow Squirrel Stoat Swallow Swan Swift Teal Thrush Toad Vole \
     Weasel Wolf Woodcock";
// A passkey holder's name, the same in every world for one person. It is a
// hash of their account id, so other players never see the id itself.
pub(super) fn holder_name(user: &str) -> String {
    let d = Sha256::digest(format!("cosyworld holder name\0{user}").as_bytes());
    let pick = |byte: u8, words: &'static str| {
        words
            .split_whitespace()
            .nth(usize::from(byte) % 64)
            .unwrap_or("Quiet")
    };
    format!("{} {}", pick(d[0], ADJECTIVES), pick(d[1], NOUNS))
}
// Who holds each of the eight avatars here, by holder name.
pub(super) fn holders(c: &Connection, id: &str) -> Result<[Option<String>; 8]> {
    let mut q = c
        .prepare("SELECT actor,user FROM card_bindings WHERE world=?")
        .map_err(sql_error)?;
    let mut names: [Option<String>; 8] = Default::default();
    for row in q
        .query_map([id], |r| {
            Ok((r.get::<_, usize>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(sql_error)?
    {
        let (a, user) = row.map_err(sql_error)?;
        if let Some(name) = names.get_mut(a) {
            *name = Some(holder_name(&user));
        }
    }
    Ok(names)
}

// The avatar this person is bound to in this world.
pub(super) fn mine(c: &Connection, id: &str, user: &str) -> Result<Option<usize>> {
    c.query_row(
        "SELECT actor FROM card_bindings WHERE world=? AND user=?",
        params![id, user],
        |r| r.get(0),
    )
    .optional()
    .map_err(sql_error)
}
// Which of the eight avatars someone is bound to.
pub(super) fn bound(c: &Connection, id: &str) -> Result<[i32; 8]> {
    let mut q = c
        .prepare("SELECT actor FROM card_bindings WHERE world=?")
        .map_err(sql_error)?;
    let mut seats = [0; 8];
    for a in q
        .query_map([id], |r| r.get::<_, usize>(0))
        .map_err(sql_error)?
    {
        if let Some(seat) = seats.get_mut(a.map_err(sql_error)?) {
            *seat = 1;
        }
    }
    Ok(seats)
}
// A new claim: the person's own avatar, or a free one while the world has
// room. Refused before anything is journaled.
pub(super) fn claim(c: &Connection, id: &str, user: &str, a: usize) -> Result<()> {
    if let Some(own) = mine(c, id, user)? {
        return if own == a {
            Ok(())
        } else {
            Err(format!(
                "You play {} in this world.",
                super::cast()["avatars"][own]["name"]
                    .as_str()
                    .unwrap_or("another avatar")
            ))
        };
    }
    let seats = bound(c, id)?;
    if seats.iter().all(|s| *s == 1) {
        return Err("This world is full.".into());
    }
    if seats[a] == 1 {
        return Err("That avatar belongs to someone else in this world.".into());
    }
    c.execute(
        "INSERT INTO card_bindings(world,actor,user) VALUES(?,?,?)",
        params![id, a, user],
    )
    .map_err(sql_error)?;
    Ok(())
}
pub(super) fn owner(c: &Connection, id: &str, user: &str) -> Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM card_tables WHERE id=? AND owner=?)",
        params![id, user],
        |r| r.get(0),
    )
    .map_err(sql_error)
}
pub(super) fn free(c: &Connection, id: &str, a: usize) -> Result<()> {
    c.execute(
        "DELETE FROM card_bindings WHERE world=? AND actor=?",
        params![id, a],
    )
    .map_err(sql_error)?;
    c.execute(
        "DELETE FROM card_members WHERE world=? AND actor=?",
        params![id, a],
    )
    .map_err(sql_error)?;
    Ok(())
}
// Who holds this avatar's seat here.
pub(super) fn holder(c: &Connection, id: &str, a: usize) -> Result<Option<String>> {
    c.query_row(
        "SELECT user FROM card_bindings WHERE world=? AND actor=?",
        params![id, a],
        |r| r.get(0),
    )
    .optional()
    .map_err(sql_error)
}
// The other worlds where this person holds this avatar's seat or claim.
pub(super) fn seats_elsewhere(
    c: &Connection,
    id: &str,
    user: &str,
    a: usize,
) -> Result<Vec<String>> {
    let mut q = c
        .prepare(
            "SELECT world FROM card_bindings WHERE user=?1 AND actor=?2 AND world<>?3
             UNION SELECT world FROM card_members WHERE user=?1 AND actor=?2 AND world<>?3",
        )
        .map_err(sql_error)?;
    let worlds = q
        .query_map(params![user, a, id], |r| r.get::<_, String>(0))
        .map_err(sql_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    Ok(worlds)
}
// An avatar's level travels with it (#1846). Between seats it is kept here;
// the next claim takes it. Rules before 80 cannot take it, so it waits.
pub(super) fn carries_progress(version: &str) -> bool {
    version
        .rsplit('/')
        .next()
        .and_then(|n| n.parse::<u32>().ok())
        .is_some_and(|n| n >= 80)
}
pub(super) fn save_progress(c: &Connection, user: &str, a: usize, progress: &Value) -> Result<()> {
    c.execute(
        "INSERT OR REPLACE INTO card_avatar_progress(user,actor,progress) VALUES(?,?,?)",
        params![user, a, progress.to_string()],
    )
    .map_err(sql_error)?;
    Ok(())
}
pub(super) fn take_progress(c: &Connection, user: &str, a: usize) -> Result<Option<Value>> {
    let saved: Option<String> = c
        .query_row(
            "SELECT progress FROM card_avatar_progress WHERE user=? AND actor=?",
            params![user, a],
            |r| r.get(0),
        )
        .optional()
        .map_err(sql_error)?;
    c.execute(
        "DELETE FROM card_avatar_progress WHERE user=? AND actor=?",
        params![user, a],
    )
    .map_err(sql_error)?;
    Ok(saved.and_then(|s| serde_json::from_str(&s).ok()))
}
// Cosmetic upgrades are one-way and per passkey (#1873). Each one is kept
// here for good and goes with every claim. Rules before 81 cannot take them.
pub(super) fn carries_upgrades(version: &str) -> bool {
    version
        .rsplit('/')
        .next()
        .and_then(|n| n.parse::<u32>().ok())
        .is_some_and(|n| n >= 81)
}
pub(super) fn upgrades(c: &Connection, user: &str, a: usize) -> Result<Vec<String>> {
    let sql = "SELECT upgrade FROM card_avatar_upgrades WHERE user=? AND actor=? ORDER BY upgrade";
    let mut q = c.prepare(sql).map_err(sql_error)?;
    let rows = q
        .query_map(params![user, a], |r| r.get(0))
        .map_err(sql_error)?;
    rows.collect::<std::result::Result<_, _>>()
        .map_err(sql_error)
}
// Keep every upgrade the rules gave this avatar in a world's state.
pub(super) fn record_upgrades(c: &Connection, user: &str, a: usize, game: &Value) -> Result<()> {
    let actor = super::full_world::actor_id(a);
    for upgrade in game["actors"][actor]["upgrades"]
        .as_array()
        .into_iter()
        .flatten()
    {
        let sql = "INSERT OR IGNORE INTO card_avatar_upgrades(user,actor,upgrade) VALUES(?,?,?)";
        c.execute(sql, params![user, a, upgrade.as_str()])
            .map_err(sql_error)?;
    }
    Ok(())
}
// The level and experience an avatar has in a world's state.
pub(super) fn progress_of(game: &Value, actor: &str) -> Value {
    let a = &game["actors"][actor];
    let mut p = serde_json::json!({ "xp": a["xp"].as_u64().unwrap_or(0) });
    if let Some(level) = a["level"].as_u64() {
        p["level"] = level.into();
    }
    p
}
