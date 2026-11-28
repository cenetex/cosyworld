pub const VISIBLE_FRAME: i32 = -2;

pub fn hand_focus(frames: &[i32], preferred: &[i32]) -> Option<usize> {
    let index = |value| usize::try_from(value).ok().filter(|&i| i < frames.len());
    let Some(mut anchor) = preferred.iter().rev().find_map(|&value| index(value)) else {
        return frames.iter().position(|&frame| frame == VISIBLE_FRAME);
    };
    for _ in frames {
        let Some(holder) = index(frames[anchor]) else {
            break;
        };
        anchor = holder;
    }
    (0..frames.len())
        .flat_map(|distance| [anchor.checked_sub(distance), anchor.checked_add(distance)])
        .flatten()
        .find(|&i| frames.get(i) == Some(&VISIBLE_FRAME))
}

#[derive(Debug, Eq, PartialEq)]
pub struct LockedStack {
    pub open: bool,
    pub top: bool,
    pub under: u32,
    pub shown: bool,
}

pub fn locked_stack(
    count: u32,
    index: u32,
    open: bool,
    holder_expanded: bool,
) -> Option<LockedStack> {
    if index >= count {
        return None;
    }
    let open = open && count > 1;
    let top = index == 0;
    Some(LockedStack {
        open,
        top,
        under: if top && !open { count - 1 } else { 0 },
        shown: open || (top && (count > 1 || holder_expanded)),
    })
}

pub const ROOM_LOCAL: i32 = 1;
pub const ROOM_WAY: i32 = 2;
pub const ROOM_BACK: i32 = 4;
pub const ROOM_FEATURED: i32 = 8;

/// The back and featured cards use the first two indexes after the input.
pub fn room_card_order(
    cards: &[i32],
    back: bool,
    featured: bool,
) -> impl Iterator<Item = usize> + '_ {
    let all = cards.iter().copied().enumerate();
    let local = all.clone().filter(|&(_, card)| card & ROOM_LOCAL != 0);
    back.then_some(cards.len())
        .into_iter()
        .chain(local.clone().take(1).map(|(index, _)| index))
        .chain(featured.then_some(cards.len() + 1))
        .chain(
            local
                .skip(1)
                .filter(|&(_, card)| card & ROOM_FEATURED == 0)
                .map(|(index, _)| index),
        )
        .chain(
            all.clone()
                .filter(|&(_, card)| card & (ROOM_LOCAL | ROOM_WAY) == 0)
                .map(|(index, _)| index),
        )
        .chain(
            all.filter(|&(_, card)| card & ROOM_WAY != 0 && card & ROOM_BACK == 0)
                .map(|(index, _)| index),
        )
}
