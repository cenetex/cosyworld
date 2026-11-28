#![deny(unsafe_code)]

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

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::{DialoguePresentation, hold_dialogue_choice};

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
