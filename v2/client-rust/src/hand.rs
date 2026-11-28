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
