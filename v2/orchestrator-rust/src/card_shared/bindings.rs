//! A person's passkey binds them to the avatar they take in a shared world
//! (#1825). The binding outlives Step away and Send to: they always return as
//! that avatar, and nobody else can claim it. The world's owner can free it
//! and the holder can release it; either starts it over as a fresh starter.
use super::store::{sql_error, Result};
use rusqlite::{params, Connection, OptionalExtension};
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
