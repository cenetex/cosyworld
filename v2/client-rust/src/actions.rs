#[repr(i32)]
pub enum QuestOffer {
    Turn = 1,
    Collect = 2,
    Discard = 3,
}

pub fn quest_action(
    offers: &[i32],
    turnable: bool,
    reward: bool,
    discardable: bool,
) -> Option<usize> {
    let wanted = if turnable {
        QuestOffer::Turn
    } else if reward {
        QuestOffer::Collect
    } else if discardable {
        QuestOffer::Discard
    } else {
        return None;
    };
    let wanted = wanted as i32;
    offers.iter().position(|&offer| offer == wanted)
}

pub fn matching_pair_action(offers: &[i32]) -> Option<usize> {
    offers
        .split(|&card| card == -2)
        .position(|cards| cards.contains(&0) && cards.contains(&1))
}
