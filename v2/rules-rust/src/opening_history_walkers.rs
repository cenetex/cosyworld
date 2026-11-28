use super::{
    create_geography::Geography, initial_wants::People, opening_content, opening_quiet_life,
    opening_resident_sleep, pack_state::Catalog,
};
use serde_json::{json, Value};

pub(super) fn verify(world: &Value, geo: &Geography<'_>, acted: &[&str]) -> Option<()> {
    let turn = world["turn"].as_u64()?;
    if turn != 481
        || world["began"] != 480
        || world["presentActors"] != json!(["vale"])
        || world["controlledActors"] != json!(["vale"])
        || world["actors"]["vale"]["place"] != "attic"
        || world["items"]["lamp"]["holder"] != "vale"
        || !world["standoffs"].as_array()?.is_empty()
    {
        return None;
    }
    let people = People::new(geo.files(), geo.packs())?;
    let ships = opening_resident_sleep::ships(geo);
    for (id, person) in people.people {
        if id == "vale" || acted.contains(&id) || person.data["roamingQuest"] == "latest-completion"
        {
            continue;
        }
        let actor = world["actors"].get(id)?;
        let here = actor["place"].as_str()?;
        if here == "attic"
            || !actor["sleeping"].is_null()
            || ships.contains(here)
            || world["peaceUntil"][id].as_u64()? > turn
        {
            continue;
        }
        let homeward = actor["homeward"] == true;
        if !homeward
            && (people.humans.contains(id) || !opening_quiet_life::ranged(world, geo, id, &person)?)
        {
            continue;
        }
        let home = opening_resident_sleep::home(world, geo, id, &person)?;
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
        if opening_resident_sleep::step_home(world, geo, id, here, home)? {
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
    verify(world, &geo, &acted)?;
    Some(json!({"ok":true, "world":world}))
}
