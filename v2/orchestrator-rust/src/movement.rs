use super::*;

pub(crate) mod accompany;
pub(crate) use accompany::ACCOMPANY_OFFER_KIND;

impl RuntimeWorld {}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum PathwayWayClass {
    #[default]
    Route,
    Track,
    Path,
    Trail,
    Road,
    Avenue,
    Highway,
}

impl PathwayWayClass {}

impl RuntimeWorld {}
