use super::{cast, engine, store::Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(super) struct World {
    pub version: String,
    pub game: Value,
    pub claimed: [i32; 8],
    pub present: [i32; 8],
}
#[repr(C)]
struct Session {
    claimed: [i32; 8],
    present: [i32; 8],
    rooms: [[u8; 128]; 8],
}
extern "C" {
    fn ct_shared_guard(before: *const Session, after: *const Session, kind: i32, actor: i32)
        -> i32;
}
pub(super) fn actor_id(a: usize) -> &'static str {
    cast()["avatars"][a]["id"].as_str().expect("cast ID")
}
pub(super) fn actor_index(id: &str) -> Result<usize> {
    (0..8)
        .find(|a| actor_id(*a) == id)
        .ok_or_else(|| "Choose one of the eight avatars.".into())
}
impl World {
    pub fn create(save: Option<&str>) -> Result<Self> {
        let result = engine::reduce(json!({"op":"create","save":save}))?;
        Ok(Self {
            version: engine::VERSION.into(),
            game: result["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
        })
    }
    pub fn room(&self, a: usize) -> Result<&str> {
        self.game["actors"][actor_id(a)]["place"]
            .as_str()
            .ok_or_else(|| "The avatar's place needs attention.".into())
    }
    pub fn request(&self, op: &str, a: usize) -> Value {
        json!({"op":op,"world":self.game,"actor":actor_id(a),
          "claimed":(0..8).filter(|i|self.claimed[*i]==1).map(actor_id).collect::<Vec<_>>(),
          "present":(0..8).filter(|i|self.present[*i]==1).map(actor_id).collect::<Vec<_>>()})
    }
    fn session(&self) -> Result<Session> {
        let mut s = Session {
            claimed: self.claimed,
            present: self.present,
            rooms: [[0; 128]; 8],
        };
        for a in 0..8 {
            let room = self.room(a)?;
            if room.is_empty() || room.len() >= 128 || room.bytes().any(|b| b == 0) {
                return Err("The place ID needs attention.".into());
            }
            s.rooms[a][..room.len()].copy_from_slice(room.as_bytes());
        }
        Ok(s)
    }
    fn guard(&self, next: &Self, kind: i32, a: usize) -> Result<()> {
        let code = unsafe { ct_shared_guard(&self.session()?, &next.session()?, kind, a as i32) };
        match code {
            0 => Ok(()),
            2 => Err("That avatar has just been claimed.".into()),
            3 => Err("Enter the room before playing.".into()),
            4 => Err("The room filled just now. Wait for a place.".into()),
            _ => Err("Choose an available play.".into()),
        }
    }
    // Every journal command is reduced through the same C guard and C-hosted
    // authored rules. AI text is appended by the authored speech reducer.
    pub fn apply(&mut self, command: &Value) -> Result<Value> {
        if command["op"] == "upgrade" {
            let target = command["to"]
                .as_str()
                .ok_or("Choose a saved rules upgrade.")?;
            let versions = [
                engine::LEGACY_VERSION,
                engine::PREVIOUS_VERSION,
                engine::FOURTH_VERSION,
                engine::FIFTH_VERSION,
                engine::SIXTH_VERSION,
                engine::SEVENTH_VERSION,
                engine::EIGHTH_VERSION,
                engine::NINTH_VERSION,
                engine::TENTH_VERSION,
                engine::ELEVENTH_VERSION,
                engine::TWELFTH_VERSION,
                engine::THIRTEENTH_VERSION,
                engine::FOURTEENTH_VERSION,
                engine::FIFTEENTH_VERSION,
                engine::SIXTEENTH_VERSION,
                engine::SEVENTEENTH_VERSION,
                engine::EIGHTEENTH_VERSION,
                engine::NINETEENTH_VERSION,
                engine::TWENTIETH_VERSION,
                engine::VERSION,
            ];
            let allowed = versions
                .iter()
                .position(|v| *v == self.version)
                .zip(versions.iter().position(|v| *v == target))
                .is_some_and(|(from, to)| from < to);
            if command["from"] != self.version || !allowed {
                return Err("This world's rules upgrade needs its original version.".into());
            }
            let mut request = self.request("upgrade", 0);
            request["from"] = json!(self.version);
            request["to"] = json!(target);
            // Recorded upgrades retain their released target transformation.
            let result = engine::reduce_version(target, request)?;
            self.game = result["world"].clone();
            self.version = target.into();
            return Ok(result);
        }
        if ![
            engine::VERSION,
            engine::PREVIOUS_VERSION,
            engine::LEGACY_VERSION,
            engine::FOURTH_VERSION,
            engine::FIFTH_VERSION,
            engine::SIXTH_VERSION,
            engine::SEVENTH_VERSION,
            engine::EIGHTH_VERSION,
            engine::NINTH_VERSION,
            engine::TENTH_VERSION,
            engine::ELEVENTH_VERSION,
            engine::TWELFTH_VERSION,
            engine::THIRTEENTH_VERSION,
            engine::FOURTEENTH_VERSION,
            engine::FIFTEENTH_VERSION,
            engine::SIXTEENTH_VERSION,
            engine::SEVENTEENTH_VERSION,
            engine::EIGHTEENTH_VERSION,
            engine::NINETEENTH_VERSION,
            engine::TWENTIETH_VERSION,
        ]
        .contains(&self.version.as_str())
        {
            return Err("This world's rules need a saved migration.".into());
        }
        let a = actor_index(command["actor"].as_str().ok_or("Choose an avatar.")?)?;
        let op = command["op"].as_str().ok_or("Choose an action.")?;
        let mut next = self.clone();
        let (kind, result) = match op {
            "claim" => {
                let result = engine::reduce_version(&self.version, self.request("join", a))?;
                next.game = result["world"].clone();
                next.claimed[a] = 1;
                (1, result)
            }
            "release" => {
                next.claimed[a] = 0;
                next.present[a] = 0;
                (2, json!({}))
            }
            "enter" => {
                next.present[a] = 1;
                (3, json!({}))
            }
            "leave" => {
                next.present[a] = 0;
                (4, json!({}))
            }
            "play" => {
                let mut request = self.request("play", a);
                request["action"] = command["action"].clone();
                let result = engine::reduce_version(&self.version, request)?;
                next.game = result["world"].clone();
                (11, result)
            }
            "speech" => {
                let mut request = self.request("speech", a);
                request["lines"] = command["lines"].clone();
                request["room"] = command["room"].clone();
                request["entries"] = command["entries"].clone();
                request["disclosures"] = command["disclosures"].clone();
                for key in ["privateTo", "hearing", "recall"] {
                    if let Some(value) = command.get(key) { request[key] = value.clone(); }
                }
                let result = engine::reduce_version(&self.version, request)?;
                next.game = result["world"].clone();
                // Committed text can finish after its speaker disconnects.
                self.guard(&next, 12, a)?;
                *self = next;
                return Ok(result);
            }
            _ => return Err("Choose an available play.".into()),
        };
        self.guard(&next, kind, a)?;
        if [2, 4].contains(&kind) {
            let leaving = actor_id(a);
            let pending_guest = next.game["packs"].as_object().into_iter().flat_map(|p| p.values())
                .flat_map(|p| p["poemReadings"]["readings"].as_object().into_iter().flat_map(|r| r.values()))
                .any(|reading| {
                    reading["complete"] == false && reading["audience"].as_array().is_some_and(|ids| {
                        ids.iter().position(|id| *id == leaving).is_some_and(|bit| {
                            reading["requiredMask"].as_u64().is_some_and(|mask| mask & (1 << bit) == 0)
                                && reading["departedMask"].as_u64().is_some_and(|mask| mask & (1 << bit) == 0)
                        })
                    })
                });
            if pending_guest {
                let attendance = engine::reduce_version(&self.version, next.request("attendance", a))?;
                next.game = attendance["world"].clone();
            }
        }
        *self = next;
        Ok(result)
    }
    pub fn project(&self, a: usize) -> Result<Value> {
        let mut view = engine::reduce_version(&self.version, self.request("view", a))?;
        // Apply privacy to every released interpreter, including older saves.
        if let Some(memories) = view["world"]["memories"].as_object_mut() {
            for (id, memory) in memories {
                if id != actor_id(a) {
                    if let Some(memory) = memory.as_object_mut() {
                        for key in ["innerLife", "reflections", "learning"] {
                            memory.remove(key);
                        }
                    }
                }
            }
        }
        Ok(view)
    }
}
