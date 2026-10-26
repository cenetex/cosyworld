use serde::{Deserialize, Serialize};
#[repr(C)]
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct World {
    pub version: i32,
    pub claimed: [i32; 8],
    pub present: [i32; 8],
    pub places: [i32; 8],
    pub holders: [i32; 8],
    pub uses: [i32; 8],
    pub homes: [i32; 8],
    pub gates: [i32; 9],
    pub turn: u32,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Action {
    pub kind: i32,
    pub actor: i32,
    pub item: i32,
    pub target: i32,
}
extern "C" {
    fn ct_init(world: *mut World);
    fn ct_apply(world: *mut World, action: Action) -> i32;
    fn ct_can_visit(world: *const World, actor: i32, place: i32) -> i32;
}
impl World {
    pub fn new() -> Self {
        let mut w = Self {
            version: 0,
            claimed: [0; 8],
            present: [0; 8],
            places: [0; 8],
            holders: [0; 8],
            uses: [0; 8],
            homes: [0; 8],
            gates: [0; 9],
            turn: 0,
        };
        // C initializes every field of this repr(C) value.
        unsafe { ct_init(&mut w) };
        w
    }
    pub fn apply(&mut self, a: Action) -> Result<(), String> {
        let code = unsafe { ct_apply(self, a) };
        match code {
            0 => Ok(()),
            1 => Err("Choose an available play.".into()),
            2 => Err("That avatar has just been claimed.".into()),
            3 => Err("Enter the room before playing.".into()),
            4 => Err("The room filled just now. Wait for a place.".into()),
            5 => Err("The way has changed. Choose a place from the current hand.".into()),
            6 => Err("That item has moved. Choose from the current hand.".into()),
            _ => Err("That person has moved. Choose someone here.".into()),
        }
    }
    pub fn exits(&self, a: i32) -> Vec<i32> {
        (0..9)
            .filter(|p| unsafe { ct_can_visit(self, a, *p) } == 1)
            .collect()
    }
}
