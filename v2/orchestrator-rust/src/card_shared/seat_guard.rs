#![forbid(unsafe_code)]

const INVALID: &str = "Choose an available play.";
const CLAIMED: &str = "That avatar has just been claimed.";
const ABSENT: &str = "Enter the room before playing.";
const FULL: &str = "The room filled just now. Wait for a place.";
const ROOM_LIMIT: usize = 4;

pub(super) enum SeatAction {
    Claim,
    Release,
    Reset,
    Enter,
    Leave,
    Play,
    Text,
}

pub(super) struct Session<'a> {
    pub(super) claimed: &'a [i32; 8],
    pub(super) present: &'a [i32; 8],
    pub(super) rooms: [&'a str; 8],
}

impl Session<'_> {
    pub(super) fn guard(
        &self,
        after: &Self,
        action: SeatAction,
        actor: usize,
    ) -> Result<(), &'static str> {
        if actor >= after.claimed.len() {
            return Err(INVALID);
        }
        for (seat, (&claimed, &present)) in after.claimed.iter().zip(after.present).enumerate() {
            if !matches!((claimed, present), (0, 0) | (1, 0) | (1, 1))
                || (seat != actor
                    && (claimed != self.claimed[seat] || present != self.present[seat]))
            {
                return Err(INVALID);
            }
        }

        use SeatAction::*;
        let (claimed, present) = (after.claimed[actor], after.present[actor]);
        let (was_claimed, was_present) = (self.claimed[actor], self.present[actor]);
        let valid = match action {
            Claim if was_claimed != 0 => return Err(CLAIMED),
            Claim => claimed == 1 && present == was_present,
            Release => was_claimed != 0 && claimed == 0 && present == 0,
            Reset => claimed == 0 && present == 0,
            Enter if was_claimed == 0 || claimed != 1 || present != 1 => return Err(ABSENT),
            Enter => true,
            Leave => claimed == was_claimed && present == 0,
            Play | Text if (claimed, present) != (was_claimed, was_present) => false,
            Play if was_claimed == 0 || was_present == 0 => return Err(ABSENT),
            Play | Text => true,
        };
        if !valid {
            return Err(INVALID);
        }

        for room in after.rooms {
            let occupants = after
                .rooms
                .iter()
                .zip(after.present)
                .filter(|&(&place, &present)| present == 1 && place == room)
                .count();
            if occupants > ROOM_LIMIT {
                return Err(FULL);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{SeatAction::*, *};

    #[test]
    fn guards_claim_presence_and_disconnected_text() {
        let before = Session {
            claimed: &[1, 1, 0, 0, 0, 0, 0, 0],
            present: &[0; 8],
            rooms: ["home"; 8],
        };
        assert_eq!(before.guard(&before, Claim, 0), Err(CLAIMED));
        assert_eq!(before.guard(&before, Play, 0), Err(ABSENT));
        assert_eq!(before.guard(&before, Text, 0), Ok(()));
        assert_eq!(before.guard(&before, Leave, 0), Ok(()));
        let released = Session {
            claimed: &[0, 1, 0, 0, 0, 0, 0, 0],
            ..before
        };
        assert_eq!(before.guard(&released, Release, 0), Ok(()));
        assert_eq!(released.guard(&before, Claim, 0), Ok(()));
        assert_eq!(released.guard(&released, Reset, 0), Ok(()));
        let after = Session {
            present: &[1, 0, 0, 0, 0, 0, 0, 0],
            ..before
        };
        assert_eq!(before.guard(&after, Enter, 0), Ok(()));
        assert_eq!(before.guard(&after, Enter, 1), Err(INVALID));
        assert_eq!(before.guard(&after, Text, 0), Err(INVALID));
        let after = Session {
            present: &[0, 0, 1, 0, 0, 0, 0, 0],
            ..before
        };
        assert_eq!(before.guard(&after, Enter, 2), Err(INVALID));
    }

    #[test]
    fn four_present_avatars_fit_in_a_room() {
        let before = Session {
            claimed: &[1; 8],
            present: &[1, 1, 1, 1, 0, 0, 0, 0],
            rooms: ["home"; 8],
        };
        assert_eq!(before.guard(&before, Play, 0), Ok(()));
        let after = Session {
            present: &[1, 1, 1, 1, 1, 0, 0, 0],
            ..before
        };
        assert_eq!(before.guard(&after, Enter, 4), Err(FULL));
        let after = Session {
            rooms: [
                "home",
                "home",
                "home",
                "home",
                "home-east",
                "home",
                "home",
                "home",
            ],
            ..after
        };
        assert_eq!(before.guard(&after, Enter, 4), Ok(()));
    }
}
