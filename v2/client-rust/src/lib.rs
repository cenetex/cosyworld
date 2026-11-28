#![deny(unsafe_code)]

mod actions;
mod hand;

pub use actions::{QuestOffer, matching_pair_action, quest_action};
pub use hand::{
    LockedStack, ROOM_BACK, ROOM_FEATURED, ROOM_LOCAL, ROOM_WAY, VISIBLE_FRAME, hand_focus,
    locked_stack, room_card_order,
};

#[derive(Debug, Default, Eq, PartialEq)]
#[repr(u32)]
pub enum DialoguePhase {
    #[default]
    Idle,
    Revealing,
    Choosing,
    Thinking,
    Reviewing,
}

#[derive(Debug, Default)]
pub struct DialoguePresentation {
    pub reviewing: bool,
    pub revealing: bool,
    pub in_flight: bool,
    pub lingering: bool,
    pub raised: bool,
    pub chosen: bool,
    pub rested: bool,
}

impl DialoguePresentation {
    pub fn phase(&self) -> DialoguePhase {
        if self.revealing {
            DialoguePhase::Revealing
        } else if self.raised && self.chosen && !self.rested && (!self.in_flight || self.lingering)
        {
            DialoguePhase::Choosing
        } else if self.in_flight && !self.lingering {
            DialoguePhase::Thinking
        } else if self.reviewing {
            DialoguePhase::Reviewing
        } else {
            DialoguePhase::Idle
        }
    }
}

pub fn hold_dialogue_choice(
    queued: bool,
    live: bool,
    complete: bool,
    speaking: bool,
    next: bool,
) -> bool {
    queued || (live && (!complete || speaking || next))
}

#[derive(Debug, Default)]
pub struct PendingSpeech {
    pub shared: bool,
    pub generating: bool,
    pub has_line: bool,
    pub preparing: bool,
    pub line_first: bool,
    pub own_play: bool,
    pub committed: bool,
}

impl PendingSpeech {
    pub fn visible(&self) -> bool {
        let waiting = (self.generating && !self.has_line) || (!self.shared && self.preparing);
        waiting || (self.own_play && !self.line_first && (self.shared || !self.committed))
    }
}

pub fn pending_effect(beats: &[i32]) -> Option<usize> {
    beats.iter().position(|&beat| beat == 0b111)
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::{DialoguePresentation, LockedStack, PendingSpeech, hold_dialogue_choice};
    use std::cell::RefCell;

    thread_local! {
        static HAND: RefCell<Vec<i32>> = const { RefCell::new(Vec::new()) };
    }

    #[expect(unsafe_code, reason = "Browser ABI export name is unique")]
    #[unsafe(no_mangle)]
    extern "C" fn hand_input(length: usize) -> usize {
        if !(1..=u16::MAX as usize).contains(&length) {
            return 0;
        }
        HAND.with_borrow_mut(|buffer| {
            buffer.resize(length, 0);
            buffer.as_mut_ptr() as usize
        })
    }

    #[expect(unsafe_code, reason = "Browser ABI export name is unique")]
    #[unsafe(no_mangle)]
    extern "C" fn hand_focus(frame_count: usize) -> i32 {
        HAND.with_borrow(|buffer| {
            let Some((frames, preferred)) = buffer.split_at_checked(frame_count) else {
                return -1;
            };
            super::hand_focus(frames, preferred).map_or(-1, |index| index as i32)
        })
    }

    #[expect(unsafe_code, reason = "Browser ABI export name is unique")]
    #[unsafe(no_mangle)]
    extern "C" fn room_card_order(card_count: usize, back: bool, featured: bool) -> usize {
        HAND.with_borrow_mut(|buffer| {
            let Some((cards, output)) = buffer.split_at_mut_checked(card_count) else {
                return 0;
            };
            let mut length = 0;
            for index in super::room_card_order(cards, back, featured) {
                let Some(slot) = output.get_mut(length) else {
                    return 0;
                };
                *slot = index as i32;
                length += 1;
            }
            length
        })
    }

    #[expect(unsafe_code, reason = "Browser ABI export name is unique")]
    #[unsafe(no_mangle)]
    extern "C" fn locked_stack(count: u32, index: u32, open: bool, holder: bool) -> u32 {
        let Some(LockedStack {
            open,
            top,
            under,
            shown,
        }) = super::locked_stack(count, index, open, holder)
        else {
            return 0;
        };
        (under << 3) | (u32::from(shown) << 2) | (u32::from(top) << 1) | u32::from(open)
    }

    #[expect(unsafe_code, reason = "Browser ABI export name is unique")]
    #[unsafe(no_mangle)]
    extern "C" fn quest_action(turnable: bool, reward: bool, discardable: bool) -> i32 {
        HAND.with_borrow(|offers| {
            super::quest_action(offers, turnable, reward, discardable)
                .map_or(-1, |index| index as i32)
        })
    }

    #[expect(unsafe_code, reason = "Browser ABI export name is unique")]
    #[unsafe(no_mangle)]
    extern "C" fn matching_pair_action() -> i32 {
        HAND.with_borrow(|offers| {
            super::matching_pair_action(offers).map_or(-1, |index| index as i32)
        })
    }

    #[expect(unsafe_code, reason = "Browser ABI export name is unique")]
    #[unsafe(no_mangle)]
    extern "C" fn pending_speech(
        shared: bool,
        generating: bool,
        has_line: bool,
        preparing: bool,
        line_first: bool,
        own_play: bool,
        committed: bool,
    ) -> bool {
        PendingSpeech {
            shared,
            generating,
            has_line,
            preparing,
            line_first,
            own_play,
            committed,
        }
        .visible()
    }

    #[expect(unsafe_code, reason = "Browser ABI export name is unique")]
    #[unsafe(no_mangle)]
    extern "C" fn pending_effect() -> i32 {
        HAND.with_borrow(|beats| super::pending_effect(beats).map_or(-1, |index| index as i32))
    }

    #[expect(
        unsafe_code,
        reason = "Browser ABI export name is unique in this module"
    )]
    #[unsafe(no_mangle)]
    extern "C" fn dialogue_phase(
        reviewing: bool,
        revealing: bool,
        in_flight: bool,
        lingering: bool,
        raised: bool,
        chosen: bool,
        rested: bool,
    ) -> u32 {
        DialoguePresentation {
            reviewing,
            revealing,
            in_flight,
            lingering,
            raised,
            chosen,
            rested,
        }
        .phase() as u32
    }

    #[expect(
        unsafe_code,
        reason = "Browser ABI export name is unique in this module"
    )]
    #[unsafe(no_mangle)]
    extern "C" fn dialogue_choice(
        queued: bool,
        live: bool,
        complete: bool,
        speaking: bool,
        next: bool,
    ) -> bool {
        hold_dialogue_choice(queued, live, complete, speaking, next)
    }
}
