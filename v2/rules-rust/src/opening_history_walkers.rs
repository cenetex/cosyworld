use super::{
    create_geography::Geography,
    opening_content, opening_quiet_life,
    opening_resident_sleep::{self, Residents},
    pack_state::Catalog,
};
use serde_json::{json, Value};

pub(super) fn verify(
    world: &Value,
    geo: &Geography<'_>,
    acted: &[&str],
    residents: &Residents<'_>,
) -> Option<()> {
    let room = world["actors"]["vale"]["place"].as_str()?;
    let turn = match room {
        "attic" => opening_resident_sleep::historic_attic(world)?,
        "pond" => opening_resident_sleep::historic_pond(world)?,
        "station" => opening_resident_sleep::historic_station(world, geo)?,
        _ => return None,
    };
    let turn = u64::try_from(turn).ok()?;
    let people = &residents.people;
    for (&id, person) in &people.people {
        if id == "vale" || acted.contains(&id) || person.data["roamingQuest"] == "latest-completion"
        {
            continue;
        }
        let actor = world["actors"].get(id)?;
        let here = actor["place"].as_str()?;
        if here == room
            || !actor["sleeping"].is_null()
            || residents.ships.contains(here)
            || world["peaceUntil"][id].as_u64()? > turn
        {
            continue;
        }
        let homeward = actor["homeward"] == true;
        if !homeward
            && (people.humans.contains(id) || !opening_quiet_life::ranged(world, geo, id, person)?)
        {
            continue;
        }
        let home = opening_resident_sleep::home(world, geo, id, person)?;
        if home == Some(here) && !homeward {
            continue;
        }
        if !geo.entity_active(world, id)? {
            continue;
        }
        let Some(home) = home.filter(|home| !home.is_empty()) else {
            if homeward {
                return None;
            }
            continue;
        };
        if !geo.entity_active(world, home)? {
            if homeward {
                return None;
            }
            continue;
        }
        if here == home
            || (actor["dwellUntil"].as_u64().unwrap_or(0) > turn
                && person.data["journey"].is_null())
        {
            continue;
        }
        if opening_resident_sleep::step_home(world, geo, id, here, home, residents)? {
            return None;
        }
    }
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let files = opening_content::files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let acted = request["acted"]
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<Vec<_>>>()?;
    let world = request.get("world")?;
    verify(world, &geo, &acted, &Residents::new(&geo)?)?;
    Some(json!({"ok":true, "world":world}))
}
