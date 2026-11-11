//! The shipping card rules run in QuickJS, a C interpreter. Rust supplies JSON
//! and owns IO; the interpreter has no filesystem, network, clocks or randomness.
use super::{content, store::Result};
use rquickjs::{Context, Function, Runtime};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

pub(super) const VERSION: &str = "full-card-world/133";
pub(super) const HUNDRED_THIRTY_SECOND_VERSION: &str = "full-card-world/132";
pub(super) const HUNDRED_THIRTY_FIRST_VERSION: &str = "full-card-world/131";
pub(super) const HUNDRED_THIRTIETH_VERSION: &str = "full-card-world/130";
pub(super) const HUNDRED_TWENTY_NINTH_VERSION: &str = "full-card-world/129";
pub(super) const HUNDRED_TWENTY_EIGHTH_VERSION: &str = "full-card-world/128";
pub(super) const HUNDRED_TWENTY_SEVENTH_VERSION: &str = "full-card-world/127";
pub(super) const HUNDRED_TWENTY_SIXTH_VERSION: &str = "full-card-world/126";
pub(super) const HUNDRED_TWENTY_FIFTH_VERSION: &str = "full-card-world/125";
pub(super) const HUNDRED_TWENTY_FOURTH_VERSION: &str = "full-card-world/124";
pub(super) const HUNDRED_TWENTY_THIRD_VERSION: &str = "full-card-world/123";
pub(super) const HUNDRED_TWENTY_SECOND_VERSION: &str = "full-card-world/122";
pub(super) const HUNDRED_TWENTY_FIRST_VERSION: &str = "full-card-world/121";
pub(super) const HUNDRED_TWENTIETH_VERSION: &str = "full-card-world/120";
pub(super) const HUNDRED_NINETEENTH_VERSION: &str = "full-card-world/119";
pub(super) const HUNDRED_EIGHTEENTH_VERSION: &str = "full-card-world/118";
pub(super) const HUNDRED_SEVENTEENTH_VERSION: &str = "full-card-world/117";
pub(super) const HUNDRED_SIXTEENTH_VERSION: &str = "full-card-world/116";
pub(super) const HUNDRED_FIFTEENTH_VERSION: &str = "full-card-world/115";
pub(super) const HUNDRED_FOURTEENTH_VERSION: &str = "full-card-world/114";
pub(super) const HUNDRED_THIRTEENTH_VERSION: &str = "full-card-world/113";
pub(super) const HUNDRED_TWELFTH_VERSION: &str = "full-card-world/112";
pub(super) const HUNDRED_ELEVENTH_VERSION: &str = "full-card-world/111";
pub(super) const HUNDRED_TENTH_VERSION: &str = "full-card-world/110";
pub(super) const HUNDRED_NINTH_VERSION: &str = "full-card-world/109";
pub(super) const HUNDRED_EIGHTH_VERSION: &str = "full-card-world/108";
pub(super) const HUNDRED_SEVENTH_VERSION: &str = "full-card-world/107";
pub(super) const HUNDRED_SIXTH_VERSION: &str = "full-card-world/106";
pub(super) const HUNDRED_FIFTH_VERSION: &str = "full-card-world/105";
pub(super) const HUNDRED_FOURTH_VERSION: &str = "full-card-world/104";
pub(super) const HUNDRED_THIRD_VERSION: &str = "full-card-world/103";
pub(super) const HUNDRED_SECOND_VERSION: &str = "full-card-world/102";
pub(super) const HUNDRED_FIRST_VERSION: &str = "full-card-world/101";
pub(super) const HUNDREDTH_VERSION: &str = "full-card-world/100";
pub(super) const NINETY_NINTH_VERSION: &str = "full-card-world/99";
pub(super) const NINETY_EIGHTH_VERSION: &str = "full-card-world/98";
pub(super) const NINETY_SEVENTH_VERSION: &str = "full-card-world/97";
pub(super) const NINETY_SIXTH_VERSION: &str = "full-card-world/96";
pub(super) const NINETY_FIFTH_VERSION: &str = "full-card-world/95";
pub(super) const NINETY_FOURTH_VERSION: &str = "full-card-world/94";
pub(super) const NINETY_THIRD_VERSION: &str = "full-card-world/93";
pub(super) const NINETY_SECOND_VERSION: &str = "full-card-world/92";
pub(super) const NINETY_FIRST_VERSION: &str = "full-card-world/91";
pub(super) const NINETIETH_VERSION: &str = "full-card-world/90";
pub(super) const EIGHTY_NINTH_VERSION: &str = "full-card-world/89";
pub(super) const EIGHTY_EIGHTH_VERSION: &str = "full-card-world/88";
pub(super) const EIGHTY_SEVENTH_VERSION: &str = "full-card-world/87";
pub(super) const EIGHTY_SIXTH_VERSION: &str = "full-card-world/86";
pub(super) const EIGHTY_FIFTH_VERSION: &str = "full-card-world/85";
pub(super) const EIGHTY_FOURTH_VERSION: &str = "full-card-world/84";
pub(super) const EIGHTY_THIRD_VERSION: &str = "full-card-world/83";
pub(super) const EIGHTY_SECOND_VERSION: &str = "full-card-world/82";
pub(super) const EIGHTY_FIRST_VERSION: &str = "full-card-world/81";
pub(super) const EIGHTIETH_VERSION: &str = "full-card-world/80";
pub(super) const SEVENTY_NINTH_VERSION: &str = "full-card-world/79";
pub(super) const SEVENTY_EIGHTH_VERSION: &str = "full-card-world/78";
pub(super) const SEVENTY_SEVENTH_VERSION: &str = "full-card-world/77";
pub(super) const SEVENTY_SIXTH_VERSION: &str = "full-card-world/76";
pub(super) const SEVENTY_FIFTH_VERSION: &str = "full-card-world/75";
pub(super) const SEVENTY_FOURTH_VERSION: &str = "full-card-world/74";
pub(super) const SEVENTY_THIRD_VERSION: &str = "full-card-world/73";
pub(super) const SEVENTY_SECOND_VERSION: &str = "full-card-world/72";
pub(super) const SEVENTY_FIRST_VERSION: &str = "full-card-world/71";
pub(super) const SEVENTIETH_VERSION: &str = "full-card-world/70";
pub(super) const SIXTY_NINTH_VERSION: &str = "full-card-world/69";
pub(super) const SIXTY_EIGHTH_VERSION: &str = "full-card-world/68";
pub(super) const SIXTY_SEVENTH_VERSION: &str = "full-card-world/67";
pub(super) const SIXTY_SIXTH_VERSION: &str = "full-card-world/66";
pub(super) const SIXTY_FIFTH_VERSION: &str = "full-card-world/65";
pub(super) const SIXTY_FOURTH_VERSION: &str = "full-card-world/64";
pub(super) const SIXTY_THIRD_VERSION: &str = "full-card-world/63";
pub(super) const SIXTY_SECOND_VERSION: &str = "full-card-world/62";
pub(super) const SIXTY_FIRST_VERSION: &str = "full-card-world/61";
pub(super) const SIXTIETH_VERSION: &str = "full-card-world/60";
pub(super) const FIFTY_NINTH_VERSION: &str = "full-card-world/59";
pub(super) const FIFTY_EIGHTH_VERSION: &str = "full-card-world/58";
pub(super) const FIFTY_SEVENTH_VERSION: &str = "full-card-world/57";
pub(super) const FIFTY_SIXTH_VERSION: &str = "full-card-world/56";
pub(super) const FIFTY_FIFTH_VERSION: &str = "full-card-world/55";
pub(super) const FIFTY_FOURTH_VERSION: &str = "full-card-world/54";
pub(super) const FIFTY_THIRD_VERSION: &str = "full-card-world/53";
pub(super) const FIFTY_SECOND_VERSION: &str = "full-card-world/52";
pub(super) const FIFTY_FIRST_VERSION: &str = "full-card-world/51";
pub(super) const FIFTIETH_VERSION: &str = "full-card-world/50";
pub(super) const FORTY_NINTH_VERSION: &str = "full-card-world/49";
pub(super) const FORTY_EIGHTH_VERSION: &str = "full-card-world/48";
pub(super) const FORTY_SEVENTH_VERSION: &str = "full-card-world/47";
pub(super) const FORTY_SIXTH_VERSION: &str = "full-card-world/46";
pub(super) const FORTY_FIFTH_VERSION: &str = "full-card-world/45";
pub(super) const FORTY_FOURTH_VERSION: &str = "full-card-world/44";
pub(super) const FORTY_THIRD_VERSION: &str = "full-card-world/43";
pub(super) const FORTY_SECOND_VERSION: &str = "full-card-world/42";
pub(super) const FORTY_FIRST_VERSION: &str = "full-card-world/41";
pub(super) const FORTIETH_VERSION: &str = "full-card-world/40";
pub(super) const THIRTY_NINTH_VERSION: &str = "full-card-world/39";
pub(super) const THIRTY_EIGHTH_VERSION: &str = "full-card-world/38";
pub(super) const THIRTY_SEVENTH_VERSION: &str = "full-card-world/37";
pub(super) const THIRTY_SIXTH_VERSION: &str = "full-card-world/36";
pub(super) const THIRTY_FIFTH_VERSION: &str = "full-card-world/35";
pub(super) const THIRTY_FOURTH_VERSION: &str = "full-card-world/34";
pub(super) const THIRTY_THIRD_VERSION: &str = "full-card-world/33";
pub(super) const THIRTY_SECOND_VERSION: &str = "full-card-world/32";
pub(super) const THIRTY_FIRST_VERSION: &str = "full-card-world/31";
pub(super) const THIRTIETH_VERSION: &str = "full-card-world/30";
pub(super) const TWENTY_NINTH_VERSION: &str = "full-card-world/29";
pub(super) const TWENTY_EIGHTH_VERSION: &str = "full-card-world/28";
pub(super) const TWENTY_SEVENTH_VERSION: &str = "full-card-world/27";
pub(super) const TWENTY_SIXTH_VERSION: &str = "full-card-world/26";
pub(super) const TWENTY_FIFTH_VERSION: &str = "full-card-world/25";
pub(super) const TWENTY_FOURTH_VERSION: &str = "full-card-world/24";
pub(super) const TWENTY_THIRD_VERSION: &str = "full-card-world/23";
pub(super) const TWENTY_SECOND_VERSION: &str = "full-card-world/22";
pub(super) const TWENTY_FIRST_VERSION: &str = "full-card-world/21";
pub(super) const TWENTIETH_VERSION: &str = "full-card-world/20";
pub(super) const NINETEENTH_VERSION: &str = "full-card-world/19";
pub(super) const EIGHTEENTH_VERSION: &str = "full-card-world/18";
pub(super) const SEVENTEENTH_VERSION: &str = "full-card-world/17";
pub(super) const SIXTEENTH_VERSION: &str = "full-card-world/16";
pub(super) const FIFTEENTH_VERSION: &str = "full-card-world/15";
pub(super) const FOURTEENTH_VERSION: &str = "full-card-world/14";
pub(super) const THIRTEENTH_VERSION: &str = "full-card-world/13";
pub(super) const TWELFTH_VERSION: &str = "full-card-world/12";
pub(super) const ELEVENTH_VERSION: &str = "full-card-world/11";
pub(super) const TENTH_VERSION: &str = "full-card-world/10";
pub(super) const NINTH_VERSION: &str = "full-card-world/9";
pub(super) const EIGHTH_VERSION: &str = "full-card-world/8";
pub(super) const SEVENTH_VERSION: &str = "full-card-world/7";
pub(super) const SIXTH_VERSION: &str = "full-card-world/6";
pub(super) const FIFTH_VERSION: &str = "full-card-world/5";
pub(super) const PREVIOUS_VERSION: &str = "full-card-world/3";
pub(super) const LEGACY_VERSION: &str = "full-card-world/2";
pub(super) const FOURTH_VERSION: &str = "full-card-world/4";
const SOURCE: &str = include_str!("engine-v133.js");
const HUNDRED_THIRTY_SECOND_SOURCE: &str = include_str!("engine-v132.js");
const HUNDRED_THIRTY_FIRST_SOURCE: &str = include_str!("engine-v131.js");
const HUNDRED_THIRTIETH_SOURCE: &str = include_str!("engine-v130.js");
const HUNDRED_TWENTY_NINTH_SOURCE: &str = include_str!("engine-v129.js");
const HUNDRED_TWENTY_EIGHTH_SOURCE: &str = include_str!("engine-v128.js");
const HUNDRED_TWENTY_SEVENTH_SOURCE: &str = include_str!("engine-v127.js");
const HUNDRED_TWENTY_SIXTH_SOURCE: &str = include_str!("engine-v126.js");
const HUNDRED_TWENTY_FIFTH_SOURCE: &str = include_str!("engine-v125.js");
const HUNDRED_TWENTY_FOURTH_SOURCE: &str = include_str!("engine-v124.js");
const HUNDRED_TWENTY_THIRD_SOURCE: &str = include_str!("engine-v123.js");
const HUNDRED_TWENTY_SECOND_SOURCE: &str = include_str!("engine-v122.js");
const HUNDRED_TWENTY_FIRST_SOURCE: &str = include_str!("engine-v121.js");
const HUNDRED_TWENTIETH_SOURCE: &str = include_str!("engine-v120.js");
const HUNDRED_NINETEENTH_SOURCE: &str = include_str!("engine-v119.js");
const HUNDRED_EIGHTEENTH_SOURCE: &str = include_str!("engine-v118.js");
const HUNDRED_SEVENTEENTH_SOURCE: &str = include_str!("engine-v117.js");
const HUNDRED_SIXTEENTH_SOURCE: &str = include_str!("engine-v116.js");
const HUNDRED_FIFTEENTH_SOURCE: &str = include_str!("engine-v115.js");
const HUNDRED_FOURTEENTH_SOURCE: &str = include_str!("engine-v114.js");
const HUNDRED_THIRTEENTH_SOURCE: &str = include_str!("engine-v113.js");
const HUNDRED_TWELFTH_SOURCE: &str = include_str!("engine-v112.js");
const HUNDRED_ELEVENTH_SOURCE: &str = include_str!("engine-v111.js");
const HUNDRED_TENTH_SOURCE: &str = include_str!("engine-v110.js");
const HUNDRED_NINTH_SOURCE: &str = include_str!("engine-v109.js");
const HUNDRED_EIGHTH_SOURCE: &str = include_str!("engine-v108.js");
const HUNDRED_SEVENTH_SOURCE: &str = include_str!("engine-v107.js");
const HUNDRED_SIXTH_SOURCE: &str = include_str!("engine-v106.js");
const HUNDRED_FIFTH_SOURCE: &str = include_str!("engine-v105.js");
const HUNDRED_FOURTH_SOURCE: &str = include_str!("engine-v104.js");
const HUNDRED_THIRD_SOURCE: &str = include_str!("engine-v103.js");
const HUNDRED_SECOND_SOURCE: &str = include_str!("engine-v102.js");
const HUNDRED_FIRST_SOURCE: &str = include_str!("engine-v101.js");
const HUNDREDTH_SOURCE: &str = include_str!("engine-v100.js");
const NINETY_NINTH_SOURCE: &str = include_str!("engine-v99.js");
const NINETY_EIGHTH_SOURCE: &str = include_str!("engine-v98.js");
const NINETY_SEVENTH_SOURCE: &str = include_str!("engine-v97.js");
const NINETY_SIXTH_SOURCE: &str = include_str!("engine-v96.js");
const NINETY_FIFTH_SOURCE: &str = include_str!("engine-v95.js");
const NINETY_FOURTH_SOURCE: &str = include_str!("engine-v94.js");
const NINETY_THIRD_SOURCE: &str = include_str!("engine-v93.js");
/// The current rules' source, whose words an imported save may use.
pub(super) fn current_source() -> &'static str {
    SOURCE
}
const NINETY_SECOND_SOURCE: &str = include_str!("engine-v92.js");
const NINETY_FIRST_SOURCE: &str = include_str!("engine-v91.js");
const NINETIETH_SOURCE: &str = include_str!("engine-v90.js");
const EIGHTY_NINTH_SOURCE: &str = include_str!("engine-v89.js");
const EIGHTY_EIGHTH_SOURCE: &str = include_str!("engine-v88.js");
const EIGHTY_SEVENTH_SOURCE: &str = include_str!("engine-v87.js");
const EIGHTY_SIXTH_SOURCE: &str = include_str!("engine-v86.js");
const EIGHTY_FIFTH_SOURCE: &str = include_str!("engine-v85.js");
const EIGHTY_FOURTH_SOURCE: &str = include_str!("engine-v84.js");
const EIGHTY_THIRD_SOURCE: &str = include_str!("engine-v83.js");
const EIGHTY_SECOND_SOURCE: &str = include_str!("engine-v82.js");
const EIGHTY_FIRST_SOURCE: &str = include_str!("engine-v81.js");
const EIGHTIETH_SOURCE: &str = include_str!("engine-v80.js");
const SEVENTY_NINTH_SOURCE: &str = include_str!("engine-v79.js");
const SEVENTY_EIGHTH_SOURCE: &str = include_str!("engine-v78.js");
const SEVENTY_SEVENTH_SOURCE: &str = include_str!("engine-v77.js");
const SEVENTY_SIXTH_SOURCE: &str = include_str!("engine-v76.js");
const SEVENTY_FIFTH_SOURCE: &str = include_str!("engine-v75.js");
const SEVENTY_FOURTH_SOURCE: &str = include_str!("engine-v74.js");
const SEVENTY_THIRD_SOURCE: &str = include_str!("engine-v73.js");
const SEVENTY_SECOND_SOURCE: &str = include_str!("engine-v72.js");
const SEVENTY_FIRST_SOURCE: &str = include_str!("engine-v71.js");
const SEVENTIETH_SOURCE: &str = include_str!("engine-v70.js");
const SIXTY_NINTH_SOURCE: &str = include_str!("engine-v69.js");
const SIXTY_EIGHTH_SOURCE: &str = include_str!("engine-v68.js");
const SIXTY_SEVENTH_SOURCE: &str = include_str!("engine-v67.js");
const SIXTY_SIXTH_SOURCE: &str = include_str!("engine-v66.js");
const SIXTY_FIFTH_SOURCE: &str = include_str!("engine-v65.js");
const SIXTY_FOURTH_SOURCE: &str = include_str!("engine-v64.js");
const SIXTY_THIRD_SOURCE: &str = include_str!("engine-v63.js");
const SIXTY_SECOND_SOURCE: &str = include_str!("engine-v62.js");
const SIXTY_FIRST_SOURCE: &str = include_str!("engine-v61.js");
const SIXTIETH_SOURCE: &str = include_str!("engine-v60.js");
const FIFTY_NINTH_SOURCE: &str = include_str!("engine-v59.js");
const FIFTY_EIGHTH_SOURCE: &str = include_str!("engine-v58.js");
const FIFTY_SEVENTH_SOURCE: &str = include_str!("engine-v57.js");
const FIFTY_SIXTH_SOURCE: &str = include_str!("engine-v56.js");
const FIFTY_FIFTH_SOURCE: &str = include_str!("engine-v55.js");
const FIFTY_FOURTH_SOURCE: &str = include_str!("engine-v54.js");
const FIFTY_THIRD_SOURCE: &str = include_str!("engine-v53.js");
const FIFTY_SECOND_SOURCE: &str = include_str!("engine-v52.js");
const FIFTY_FIRST_SOURCE: &str = include_str!("engine-v51.js");
const FIFTIETH_SOURCE: &str = include_str!("engine-v50.js");
const FORTY_NINTH_SOURCE: &str = include_str!("engine-v49.js");
const FORTY_EIGHTH_SOURCE: &str = include_str!("engine-v48.js");
const FORTY_SEVENTH_SOURCE: &str = include_str!("engine-v47.js");
const FORTY_SIXTH_SOURCE: &str = include_str!("engine-v46.js");
const FORTY_FIFTH_SOURCE: &str = include_str!("engine-v45.js");
const FORTY_FOURTH_SOURCE: &str = include_str!("engine-v44.js");
const FORTY_THIRD_SOURCE: &str = include_str!("engine-v43.js");
const FORTY_SECOND_SOURCE: &str = include_str!("engine-v42.js");
const FORTY_FIRST_SOURCE: &str = include_str!("engine-v41.js");
const FORTIETH_SOURCE: &str = include_str!("engine-v40.js");
const THIRTY_NINTH_SOURCE: &str = include_str!("engine-v39.js");
const THIRTY_EIGHTH_SOURCE: &str = include_str!("engine-v38.js");
const THIRTY_SEVENTH_SOURCE: &str = include_str!("engine-v37.js");
const THIRTY_SIXTH_SOURCE: &str = include_str!("engine-v36.js");
const THIRTY_FIFTH_SOURCE: &str = include_str!("engine-v35.js");
const THIRTY_FOURTH_SOURCE: &str = include_str!("engine-v34.js");
const THIRTY_THIRD_SOURCE: &str = include_str!("engine-v33.js");
const THIRTY_SECOND_SOURCE: &str = include_str!("engine-v32.js");
const THIRTY_FIRST_SOURCE: &str = include_str!("engine-v31.js");
const THIRTIETH_SOURCE: &str = include_str!("engine-v30.js");
const TWENTY_NINTH_SOURCE: &str = include_str!("engine-v29.js");
const TWENTY_EIGHTH_SOURCE: &str = include_str!("engine-v28.js");
const TWENTY_SEVENTH_SOURCE: &str = include_str!("engine-v27.js");
const TWENTY_SIXTH_SOURCE: &str = include_str!("engine-v26.js");
const TWENTY_FIFTH_SOURCE: &str = include_str!("engine-v25.js");
const TWENTY_FOURTH_SOURCE: &str = include_str!("engine-v24.js");
const TWENTY_THIRD_SOURCE: &str = include_str!("engine-v23.js");
const TWENTY_SECOND_SOURCE: &str = include_str!("engine-v22.js");
const TWENTY_FIRST_SOURCE: &str = include_str!("engine-v21.js");
const TWENTIETH_SOURCE: &str = include_str!("engine-v20.js");
const NINETEENTH_SOURCE: &str = include_str!("engine-v19.js");
const EIGHTEENTH_SOURCE: &str = include_str!("engine-v18.js");
const SEVENTEENTH_SOURCE: &str = include_str!("engine-v17.js");
const SIXTEENTH_SOURCE: &str = include_str!("engine-v16.js");
const FIFTEENTH_SOURCE: &str = include_str!("engine-v15.js");
const FOURTEENTH_SOURCE: &str = include_str!("engine-v14.js");
const THIRTEENTH_SOURCE: &str = include_str!("engine-v13.js");
const TWELFTH_SOURCE: &str = include_str!("engine-v12.js");
const ELEVENTH_SOURCE: &str = include_str!("engine-v11.js");
const TENTH_SOURCE: &str = include_str!("engine-v10.js");
const NINTH_SOURCE: &str = include_str!("engine-v9.js");
const EIGHTH_SOURCE: &str = include_str!("engine-v8.js");
const SEVENTH_SOURCE: &str = include_str!("engine-v7.js");
const SIXTH_SOURCE: &str = include_str!("engine-v6.js");
const FIFTH_SOURCE: &str = include_str!("engine-v5.js");
const FOURTH_SOURCE: &str = include_str!("engine-v4.js");
// Released rule bundles retain the exact semantics of their journal entries.
const PREVIOUS_SOURCE: &str = include_str!("engine-v3.js");
const LEGACY_SOURCE: &str = include_str!("engine-v2.js");
// A world saved by rules newer than this server's: a release swap briefly
// runs the older build (docs/release.md), so the world waits, unchanged.
pub(super) const UPDATING: &str = "This world is updating. Back in a moment.";
pub(super) fn newer(version: &str) -> bool {
    let number = |v: &str| v.strip_prefix("full-card-world/")?.parse::<u32>().ok();
    number(version)
        .zip(number(VERSION))
        .is_some_and(|(v, ours)| v > ours)
}
pub(super) fn historical(version: &str) -> bool {
    matches!(
        version,
        LEGACY_VERSION
            | PREVIOUS_VERSION
            | FOURTH_VERSION
            | FIFTH_VERSION
            | SIXTH_VERSION
            | SEVENTH_VERSION
            | EIGHTH_VERSION
            | NINTH_VERSION
            | TENTH_VERSION
            | ELEVENTH_VERSION
            | TWELFTH_VERSION
            | THIRTEENTH_VERSION
            | FOURTEENTH_VERSION
            | FIFTEENTH_VERSION
            | SIXTEENTH_VERSION
            | SEVENTEENTH_VERSION
            | EIGHTEENTH_VERSION
            | NINETEENTH_VERSION
            | TWENTIETH_VERSION
            | TWENTY_FIRST_VERSION
            | TWENTY_SECOND_VERSION
            | TWENTY_THIRD_VERSION
            | TWENTY_FOURTH_VERSION
            | TWENTY_FIFTH_VERSION
            | TWENTY_SIXTH_VERSION
            | TWENTY_SEVENTH_VERSION
            | TWENTY_EIGHTH_VERSION
            | TWENTY_NINTH_VERSION
            | THIRTIETH_VERSION
            | THIRTY_FIRST_VERSION
            | THIRTY_SECOND_VERSION
            | THIRTY_THIRD_VERSION
            | THIRTY_FOURTH_VERSION
            | THIRTY_FIFTH_VERSION
            | THIRTY_SIXTH_VERSION
            | THIRTY_SEVENTH_VERSION
            | THIRTY_EIGHTH_VERSION
            | THIRTY_NINTH_VERSION
            | FORTIETH_VERSION
            | FORTY_FIRST_VERSION
            | FORTY_SECOND_VERSION
            | FORTY_THIRD_VERSION
            | FORTY_FOURTH_VERSION
            | FORTY_FIFTH_VERSION
            | FORTY_SIXTH_VERSION
            | FORTY_SEVENTH_VERSION
            | FORTY_EIGHTH_VERSION
            | FORTY_NINTH_VERSION
            | FIFTIETH_VERSION
            | FIFTY_FIRST_VERSION
            | FIFTY_SECOND_VERSION
            | FIFTY_THIRD_VERSION
            | FIFTY_FOURTH_VERSION
            | FIFTY_FIFTH_VERSION
            | FIFTY_SIXTH_VERSION
            | FIFTY_SEVENTH_VERSION
            | FIFTY_EIGHTH_VERSION
            | FIFTY_NINTH_VERSION
            | SIXTIETH_VERSION
            | SIXTY_FIRST_VERSION
            | SIXTY_SECOND_VERSION
            | SIXTY_THIRD_VERSION
            | SIXTY_FOURTH_VERSION
            | SIXTY_FIFTH_VERSION
            | SIXTY_SIXTH_VERSION
            | SIXTY_SEVENTH_VERSION
            | SIXTY_EIGHTH_VERSION
            | SIXTY_NINTH_VERSION
            | SEVENTIETH_VERSION
            | SEVENTY_FIRST_VERSION
            | SEVENTY_SECOND_VERSION
            | SEVENTY_THIRD_VERSION
            | SEVENTY_FOURTH_VERSION
            | SEVENTY_FIFTH_VERSION
            | SEVENTY_SIXTH_VERSION
            | SEVENTY_SEVENTH_VERSION
            | SEVENTY_EIGHTH_VERSION
            | SEVENTY_NINTH_VERSION
            | EIGHTIETH_VERSION
            | EIGHTY_FIRST_VERSION
            | EIGHTY_SECOND_VERSION
            | EIGHTY_THIRD_VERSION
            | EIGHTY_FOURTH_VERSION
            | EIGHTY_FIFTH_VERSION
            | EIGHTY_SIXTH_VERSION
            | EIGHTY_SEVENTH_VERSION
            | EIGHTY_EIGHTH_VERSION
            | EIGHTY_NINTH_VERSION
            | NINETIETH_VERSION
            | NINETY_FIRST_VERSION
            | NINETY_SECOND_VERSION
            | NINETY_THIRD_VERSION
            | NINETY_FOURTH_VERSION
            | NINETY_FIFTH_VERSION
            | NINETY_SIXTH_VERSION
            | NINETY_SEVENTH_VERSION
            | NINETY_EIGHTH_VERSION
            | NINETY_NINTH_VERSION
            | HUNDREDTH_VERSION
            | HUNDRED_FIRST_VERSION
            | HUNDRED_SECOND_VERSION
            | HUNDRED_THIRD_VERSION
            | HUNDRED_FOURTH_VERSION
            | HUNDRED_FIFTH_VERSION
            | HUNDRED_SIXTH_VERSION
            | HUNDRED_SEVENTH_VERSION
            | HUNDRED_EIGHTH_VERSION
            | HUNDRED_NINTH_VERSION
            | HUNDRED_TENTH_VERSION
            | HUNDRED_ELEVENTH_VERSION
            | HUNDRED_TWELFTH_VERSION
            | HUNDRED_THIRTEENTH_VERSION
            | HUNDRED_FOURTEENTH_VERSION
            | HUNDRED_FIFTEENTH_VERSION
            | HUNDRED_SIXTEENTH_VERSION
            | HUNDRED_SEVENTEENTH_VERSION
            | HUNDRED_EIGHTEENTH_VERSION
            | HUNDRED_NINETEENTH_VERSION
            | HUNDRED_TWENTIETH_VERSION
            | HUNDRED_TWENTY_FIRST_VERSION
            | HUNDRED_TWENTY_SECOND_VERSION
            | HUNDRED_TWENTY_THIRD_VERSION
            | HUNDRED_TWENTY_FOURTH_VERSION
            | HUNDRED_TWENTY_FIFTH_VERSION
            | HUNDRED_TWENTY_SIXTH_VERSION
            | HUNDRED_TWENTY_SEVENTH_VERSION
            | HUNDRED_TWENTY_EIGHTH_VERSION
            | HUNDRED_TWENTY_NINTH_VERSION
            | HUNDRED_THIRTIETH_VERSION
            | HUNDRED_THIRTY_FIRST_VERSION
            | HUNDRED_THIRTY_SECOND_VERSION
    )
}
const MAX_BYTES: usize = 4 * 1024 * 1024;
const CACHE_ENTRIES: usize = 32;
const CACHE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Default)]
struct Views {
    entries: VecDeque<(String, String)>,
    bytes: usize,
}
impl Views {
    fn get(&mut self, input: &str) -> Option<String> {
        let index = self.entries.iter().position(|(key, _)| key == input)?;
        let entry = self.entries.remove(index)?;
        let output = entry.1.clone();
        self.entries.push_back(entry);
        Some(output)
    }
    fn put(&mut self, input: String, output: String) {
        let bytes = input.len() + output.len();
        if bytes > CACHE_BYTES || self.entries.iter().any(|(key, _)| *key == input) {
            return;
        }
        while self.entries.len() >= CACHE_ENTRIES || self.bytes + bytes > CACHE_BYTES {
            if let Some((key, value)) = self.entries.pop_front() {
                self.bytes -= key.len() + value.len();
            }
        }
        self.bytes += bytes;
        self.entries.push_back((input, output));
    }
}
fn views() -> &'static Mutex<Views> {
    static VIEWS: OnceLock<Mutex<Views>> = OnceLock::new();
    VIEWS.get_or_init(|| Mutex::new(Views::default()))
}

fn view_cache_key(version: &str, input: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(version.as_bytes());
    hash.update([0]);
    hash.update(input.as_bytes());
    format!("{version}:{:x}", hash.finalize())
}

pub(super) fn reduce(request: Value) -> Result<Value> {
    reduce_pack(VERSION, Some(content::current()), request)
}
// Tests reduce released rules directly; content-taking rules get this binary's.
#[cfg(test)]
pub(super) fn reduce_version(version: &str, request: Value) -> Result<Value> {
    reduce_pack(version, Some(content::current()), request)
}
/// Whether `version` reads pack content from the host instead of carrying it.
pub(super) fn takes_content(version: &str) -> bool {
    source(version).is_some_and(content::takes_content)
}
// Rules from v58 on receive the world's pack content; older rules carry theirs.
pub(super) fn reduce_pack(version: &str, pack: Option<&str>, request: Value) -> Result<Value> {
    let source = source(version).ok_or("This world needs a supported rules version.")?;
    let content = if content::takes_content(source) {
        Some(content::text(
            pack.ok_or("This world's pack content needs recovery.")?,
        )?)
    } else {
        None
    };
    reduce_source(version, source, content.as_deref().zip(pack), request)
}
fn source(version: &str) -> Option<&'static str> {
    Some(match version {
        VERSION => SOURCE,
        HUNDRED_THIRTY_SECOND_VERSION => HUNDRED_THIRTY_SECOND_SOURCE,
        HUNDRED_THIRTY_FIRST_VERSION => HUNDRED_THIRTY_FIRST_SOURCE,
        HUNDRED_THIRTIETH_VERSION => HUNDRED_THIRTIETH_SOURCE,
        HUNDRED_TWENTY_NINTH_VERSION => HUNDRED_TWENTY_NINTH_SOURCE,
        HUNDRED_TWENTY_EIGHTH_VERSION => HUNDRED_TWENTY_EIGHTH_SOURCE,
        HUNDRED_TWENTY_SEVENTH_VERSION => HUNDRED_TWENTY_SEVENTH_SOURCE,
        HUNDRED_TWENTY_SIXTH_VERSION => HUNDRED_TWENTY_SIXTH_SOURCE,
        HUNDRED_TWENTY_FIFTH_VERSION => HUNDRED_TWENTY_FIFTH_SOURCE,
        HUNDRED_TWENTY_FOURTH_VERSION => HUNDRED_TWENTY_FOURTH_SOURCE,
        HUNDRED_TWENTY_THIRD_VERSION => HUNDRED_TWENTY_THIRD_SOURCE,
        HUNDRED_TWENTY_SECOND_VERSION => HUNDRED_TWENTY_SECOND_SOURCE,
        HUNDRED_TWENTY_FIRST_VERSION => HUNDRED_TWENTY_FIRST_SOURCE,
        HUNDRED_TWENTIETH_VERSION => HUNDRED_TWENTIETH_SOURCE,
        HUNDRED_NINETEENTH_VERSION => HUNDRED_NINETEENTH_SOURCE,
        HUNDRED_EIGHTEENTH_VERSION => HUNDRED_EIGHTEENTH_SOURCE,
        HUNDRED_SEVENTEENTH_VERSION => HUNDRED_SEVENTEENTH_SOURCE,
        HUNDRED_SIXTEENTH_VERSION => HUNDRED_SIXTEENTH_SOURCE,
        HUNDRED_FIFTEENTH_VERSION => HUNDRED_FIFTEENTH_SOURCE,
        HUNDRED_FOURTEENTH_VERSION => HUNDRED_FOURTEENTH_SOURCE,
        HUNDRED_THIRTEENTH_VERSION => HUNDRED_THIRTEENTH_SOURCE,
        HUNDRED_TWELFTH_VERSION => HUNDRED_TWELFTH_SOURCE,
        HUNDRED_ELEVENTH_VERSION => HUNDRED_ELEVENTH_SOURCE,
        HUNDRED_TENTH_VERSION => HUNDRED_TENTH_SOURCE,
        HUNDRED_NINTH_VERSION => HUNDRED_NINTH_SOURCE,
        HUNDRED_EIGHTH_VERSION => HUNDRED_EIGHTH_SOURCE,
        HUNDRED_SEVENTH_VERSION => HUNDRED_SEVENTH_SOURCE,
        HUNDRED_SIXTH_VERSION => HUNDRED_SIXTH_SOURCE,
        HUNDRED_FIFTH_VERSION => HUNDRED_FIFTH_SOURCE,
        HUNDRED_FOURTH_VERSION => HUNDRED_FOURTH_SOURCE,
        HUNDRED_THIRD_VERSION => HUNDRED_THIRD_SOURCE,
        HUNDRED_SECOND_VERSION => HUNDRED_SECOND_SOURCE,
        HUNDRED_FIRST_VERSION => HUNDRED_FIRST_SOURCE,
        HUNDREDTH_VERSION => HUNDREDTH_SOURCE,
        NINETY_NINTH_VERSION => NINETY_NINTH_SOURCE,
        NINETY_EIGHTH_VERSION => NINETY_EIGHTH_SOURCE,
        NINETY_SEVENTH_VERSION => NINETY_SEVENTH_SOURCE,
        NINETY_SIXTH_VERSION => NINETY_SIXTH_SOURCE,
        NINETY_FIFTH_VERSION => NINETY_FIFTH_SOURCE,
        NINETY_FOURTH_VERSION => NINETY_FOURTH_SOURCE,
        NINETY_THIRD_VERSION => NINETY_THIRD_SOURCE,
        NINETY_SECOND_VERSION => NINETY_SECOND_SOURCE,
        NINETY_FIRST_VERSION => NINETY_FIRST_SOURCE,
        NINETIETH_VERSION => NINETIETH_SOURCE,
        EIGHTY_NINTH_VERSION => EIGHTY_NINTH_SOURCE,
        EIGHTY_EIGHTH_VERSION => EIGHTY_EIGHTH_SOURCE,
        EIGHTY_SEVENTH_VERSION => EIGHTY_SEVENTH_SOURCE,
        EIGHTY_SIXTH_VERSION => EIGHTY_SIXTH_SOURCE,
        EIGHTY_FIFTH_VERSION => EIGHTY_FIFTH_SOURCE,
        EIGHTY_FOURTH_VERSION => EIGHTY_FOURTH_SOURCE,
        EIGHTY_THIRD_VERSION => EIGHTY_THIRD_SOURCE,
        EIGHTY_SECOND_VERSION => EIGHTY_SECOND_SOURCE,
        EIGHTY_FIRST_VERSION => EIGHTY_FIRST_SOURCE,
        EIGHTIETH_VERSION => EIGHTIETH_SOURCE,
        SEVENTY_NINTH_VERSION => SEVENTY_NINTH_SOURCE,
        SEVENTY_EIGHTH_VERSION => SEVENTY_EIGHTH_SOURCE,
        SEVENTY_SEVENTH_VERSION => SEVENTY_SEVENTH_SOURCE,
        SEVENTY_SIXTH_VERSION => SEVENTY_SIXTH_SOURCE,
        SEVENTY_FIFTH_VERSION => SEVENTY_FIFTH_SOURCE,
        SEVENTY_FOURTH_VERSION => SEVENTY_FOURTH_SOURCE,
        SEVENTY_THIRD_VERSION => SEVENTY_THIRD_SOURCE,
        SEVENTY_SECOND_VERSION => SEVENTY_SECOND_SOURCE,
        SEVENTY_FIRST_VERSION => SEVENTY_FIRST_SOURCE,
        SEVENTIETH_VERSION => SEVENTIETH_SOURCE,
        SIXTY_NINTH_VERSION => SIXTY_NINTH_SOURCE,
        SIXTY_EIGHTH_VERSION => SIXTY_EIGHTH_SOURCE,
        SIXTY_SEVENTH_VERSION => SIXTY_SEVENTH_SOURCE,
        SIXTY_SIXTH_VERSION => SIXTY_SIXTH_SOURCE,
        SIXTY_FIFTH_VERSION => SIXTY_FIFTH_SOURCE,
        SIXTY_FOURTH_VERSION => SIXTY_FOURTH_SOURCE,
        SIXTY_THIRD_VERSION => SIXTY_THIRD_SOURCE,
        SIXTY_SECOND_VERSION => SIXTY_SECOND_SOURCE,
        SIXTY_FIRST_VERSION => SIXTY_FIRST_SOURCE,
        SIXTIETH_VERSION => SIXTIETH_SOURCE,
        FIFTY_NINTH_VERSION => FIFTY_NINTH_SOURCE,
        FIFTY_EIGHTH_VERSION => FIFTY_EIGHTH_SOURCE,
        FIFTY_SEVENTH_VERSION => FIFTY_SEVENTH_SOURCE,
        FIFTY_SIXTH_VERSION => FIFTY_SIXTH_SOURCE,
        FIFTY_FIFTH_VERSION => FIFTY_FIFTH_SOURCE,
        FIFTY_FOURTH_VERSION => FIFTY_FOURTH_SOURCE,
        FIFTY_THIRD_VERSION => FIFTY_THIRD_SOURCE,
        FIFTY_SECOND_VERSION => FIFTY_SECOND_SOURCE,
        FIFTY_FIRST_VERSION => FIFTY_FIRST_SOURCE,
        FIFTIETH_VERSION => FIFTIETH_SOURCE,
        FORTY_NINTH_VERSION => FORTY_NINTH_SOURCE,
        FORTY_EIGHTH_VERSION => FORTY_EIGHTH_SOURCE,
        FORTY_SEVENTH_VERSION => FORTY_SEVENTH_SOURCE,
        FORTY_SIXTH_VERSION => FORTY_SIXTH_SOURCE,
        FORTY_FIFTH_VERSION => FORTY_FIFTH_SOURCE,
        FORTY_FOURTH_VERSION => FORTY_FOURTH_SOURCE,
        FORTY_THIRD_VERSION => FORTY_THIRD_SOURCE,
        FORTY_SECOND_VERSION => FORTY_SECOND_SOURCE,
        FORTY_FIRST_VERSION => FORTY_FIRST_SOURCE,
        FORTIETH_VERSION => FORTIETH_SOURCE,
        THIRTY_NINTH_VERSION => THIRTY_NINTH_SOURCE,
        THIRTY_EIGHTH_VERSION => THIRTY_EIGHTH_SOURCE,
        THIRTY_SEVENTH_VERSION => THIRTY_SEVENTH_SOURCE,
        THIRTY_SIXTH_VERSION => THIRTY_SIXTH_SOURCE,
        THIRTY_FIFTH_VERSION => THIRTY_FIFTH_SOURCE,
        THIRTY_FOURTH_VERSION => THIRTY_FOURTH_SOURCE,
        THIRTY_THIRD_VERSION => THIRTY_THIRD_SOURCE,
        THIRTY_SECOND_VERSION => THIRTY_SECOND_SOURCE,
        THIRTY_FIRST_VERSION => THIRTY_FIRST_SOURCE,
        THIRTIETH_VERSION => THIRTIETH_SOURCE,
        TWENTY_NINTH_VERSION => TWENTY_NINTH_SOURCE,
        TWENTY_EIGHTH_VERSION => TWENTY_EIGHTH_SOURCE,
        TWENTY_SEVENTH_VERSION => TWENTY_SEVENTH_SOURCE,
        TWENTY_SIXTH_VERSION => TWENTY_SIXTH_SOURCE,
        TWENTY_FIFTH_VERSION => TWENTY_FIFTH_SOURCE,
        TWENTY_FOURTH_VERSION => TWENTY_FOURTH_SOURCE,
        TWENTY_THIRD_VERSION => TWENTY_THIRD_SOURCE,
        TWENTY_SECOND_VERSION => TWENTY_SECOND_SOURCE,
        TWENTY_FIRST_VERSION => TWENTY_FIRST_SOURCE,
        TWENTIETH_VERSION => TWENTIETH_SOURCE,
        NINETEENTH_VERSION => NINETEENTH_SOURCE,
        EIGHTEENTH_VERSION => EIGHTEENTH_SOURCE,
        PREVIOUS_VERSION => PREVIOUS_SOURCE,
        FOURTH_VERSION => FOURTH_SOURCE,
        FIFTH_VERSION => FIFTH_SOURCE,
        SIXTH_VERSION => SIXTH_SOURCE,
        SEVENTH_VERSION => SEVENTH_SOURCE,
        EIGHTH_VERSION => EIGHTH_SOURCE,
        NINTH_VERSION => NINTH_SOURCE,
        TENTH_VERSION => TENTH_SOURCE,
        ELEVENTH_VERSION => ELEVENTH_SOURCE,
        TWELFTH_VERSION => TWELFTH_SOURCE,
        THIRTEENTH_VERSION => THIRTEENTH_SOURCE,
        FOURTEENTH_VERSION => FOURTEENTH_SOURCE,
        FIFTEENTH_VERSION => FIFTEENTH_SOURCE,
        SIXTEENTH_VERSION => SIXTEENTH_SOURCE,
        SEVENTEENTH_VERSION => SEVENTEENTH_SOURCE,
        LEGACY_VERSION => LEGACY_SOURCE,
        _ => return None,
    })
}
fn reduce_source(
    version: &str,
    source: &str,
    content: Option<(&str, &str)>,
    request: Value,
) -> Result<Value> {
    let view = request["op"] == "view";
    let input = serde_json::to_string(&request).map_err(|_| "Choose a saved world.".to_string())?;
    if input.len() > MAX_BYTES {
        return Err("This saved world is too large to share.".into());
    }
    // Two content revisions under one engine never share a cached view.
    let cache_key = view.then(|| match content {
        Some((_, pack)) => view_cache_key(&format!("{version}+{pack}"), &input),
        None => view_cache_key(version, &input),
    });
    // A projection is pure for its exact world, actor, claims and presence.
    // Keep only successful serialized projections. Commands always run in C.
    if let Some(cache_key) = cache_key.as_deref() {
        let cached = views()
            .lock()
            .ok()
            .and_then(|mut cache| cache.get(cache_key));
        if let Some(output) = cached {
            return serde_json::from_str(&output)
                .map_err(|_| "The shared-world rules need attention.".to_string());
        }
    }
    let runtime = Runtime::new().map_err(engine_error)?;
    runtime.set_memory_limit(96 * 1024 * 1024);
    runtime.set_max_stack_size(1024 * 1024);
    // The deadline bounds one request. When it fires, QuickJS throws an
    // uncatchable interrupt; record it so a slow host is reported as a
    // timeout rather than as the rules rejecting a stale play.
    let deadline = Instant::now() + Duration::from_secs(2);
    let interrupted = Arc::new(AtomicBool::new(false));
    let flag = interrupted.clone();
    runtime.set_interrupt_handler(Some(Box::new(move || {
        let expired = Instant::now() > deadline;
        if expired {
            flag.store(true, Ordering::Relaxed);
        }
        expired
    })));
    let context = Context::full(&runtime).map_err(engine_error)?;
    let output = context.with(|ctx| -> Result<String> {
        ctx.eval::<(), _>("globalThis.structuredClone = value => JSON.parse(JSON.stringify(value)); globalThis.Date = undefined; Math.random = () => { throw new Error('Randomness must come from the saved world.'); };")
            .map_err(engine_error)?;
        if let Some((content, _)) = content {
            let content = ctx.json_parse(content).map_err(engine_error)?;
            ctx.globals().set("cardContent", content).map_err(engine_error)?;
        }
        ctx.eval::<(), _>(source).map_err(|error| {
            if interrupted.load(Ordering::Relaxed) {
                return deadline_error(version);
            }
            tracing::error!(error=%error, exception=?ctx.catch(), "shared rules failed to load");
            "The shared-world rules need attention.".to_string()
        })?;
        let entry: Function = ctx.globals().get("cardShared").map_err(engine_error)?;
        entry.call((input.as_str(),)).map_err(|error| {
            if interrupted.load(Ordering::Relaxed) {
                return deadline_error(version);
            }
            tracing::warn!(error=%error, exception=?ctx.catch(), "shared rules rejected a request");
            "The scene changed. Choose from the current cards.".to_string()
        })
    })?;
    if output.len() > MAX_BYTES {
        return Err("This saved world is too large to share.".into());
    }
    let value: Value = serde_json::from_str(&output)
        .map_err(|_| "The shared-world rules need attention.".to_string())?;
    if value["ok"] == false || value["error"].is_string() {
        return Err(value["error"]
            .as_str()
            .unwrap_or("Choose from the current cards.")
            .chars()
            .take(240)
            .collect());
    }
    if let Some(cache_key) = cache_key {
        if let Ok(mut cache) = views().lock() {
            cache.put(cache_key, output);
        }
    }
    Ok(value)
}
const DEADLINE_ERROR: &str = "The shared world is taking a moment. Try again.";
fn deadline_error(version: &str) -> String {
    tracing::warn!(version, "shared rules reached the interpreter deadline");
    DEADLINE_ERROR.into()
}
fn engine_error(error: impl std::fmt::Display) -> String {
    tracing::warn!(error=%error, "shared C interpreter error");
    "The shared world is taking a moment. Try again.".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn view_cache_keys_cover_the_exact_world_and_viewer() {
        let input = serde_json::json!({
            "op":"view", "world":{"revision":4}, "actor":"vale",
            "claimed":["vale"], "present":["vale"]
        });
        let original = view_cache_key(VERSION, &input.to_string());
        assert_eq!(original, view_cache_key(VERSION, &input.to_string()));
        assert_ne!(
            original,
            view_cache_key(EIGHTEENTH_VERSION, &input.to_string())
        );
        for (field, value) in [
            ("world", serde_json::json!({"revision":5})),
            ("actor", serde_json::json!("mara")),
            ("claimed", serde_json::json!(["vale", "mara"])),
            ("present", serde_json::json!([])),
        ] {
            let mut changed = input.clone();
            changed[field] = value;
            assert_ne!(
                original,
                view_cache_key(VERSION, &changed.to_string()),
                "{field}"
            );
        }
        assert_ne!(view_cache_key("a", "bc"), view_cache_key("ab", "c"));
    }

    #[test]
    fn compact_keys_keep_eight_large_views_within_the_existing_budget() {
        let mut cache = Views::default();
        let world = "saved world ".repeat(48 * 1024);
        let output = "view".repeat(96 * 1024);
        let mut keys = Vec::new();
        let mut original_bytes = 0;
        for actor in 0..8 {
            let input = serde_json::json!({"actor":actor,"world":world}).to_string();
            let key = view_cache_key(VERSION, &input);
            assert!(key.len() < 128);
            original_bytes += VERSION.len() + 1 + input.len() + output.len();
            cache.put(key.clone(), output.clone());
            keys.push(key);
        }
        assert!(original_bytes > CACHE_BYTES);
        assert_eq!(cache.entries.len(), 8);
        assert!(cache.bytes <= CACHE_BYTES);
        for key in keys {
            assert_eq!(cache.get(&key).as_deref(), Some(output.as_str()));
        }
    }

    #[test]
    fn view_cache_bounds_entries_and_combined_payload() {
        let mut cache = Views::default();
        for n in 0..40 {
            cache.put(n.to_string(), "view".into());
        }
        assert_eq!(cache.entries.len(), CACHE_ENTRIES);
        assert!(cache.get("0").is_none());
        assert_eq!(cache.get("39").as_deref(), Some("view"));
        cache.put("oversize".into(), "x".repeat(CACHE_BYTES));
        assert!(cache.get("oversize").is_none());
        for n in 40..50 {
            cache.put(n.to_string(), "x".repeat(CACHE_BYTES / 3));
        }
        assert!(cache.entries.len() <= CACHE_ENTRIES);
        assert!(cache.bytes <= CACHE_BYTES);
        assert_eq!(
            cache.bytes,
            cache
                .entries
                .iter()
                .map(|(key, value)| key.len() + value.len())
                .sum::<usize>()
        );
    }
}
