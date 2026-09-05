use super::*;

use std::ffi::CStr;

pub(crate) fn canonical_command_receipt_key(world_id: &str, intent_id: &str) -> String {
    format!("{world_id}\u{0}{intent_id}")
}

pub(crate) fn purge_expired_command_receipts(
    path: &Path,
    retention: CommandReceiptRetention,
) -> io::Result<usize> {
    init_event_store(path)?;
    purge_expired_command_receipts_for_retention(path, retention, now_millis())
}

pub(crate) fn snapshot_error(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

pub(crate) fn sqlite_error(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
}

pub(crate) fn event_store_error_code(error: &io::Error) -> &'static str {
    match error.kind() {
        io::ErrorKind::NotFound => "not_found",
        io::ErrorKind::PermissionDenied => "permission_denied",
        io::ErrorKind::OutOfMemory => "out_of_memory",
        io::ErrorKind::InvalidData => "invalid_data",
        io::ErrorKind::StorageFull => "storage_full",
        io::ErrorKind::ReadOnlyFilesystem => "read_only_filesystem",
        _ => "sqlite_io_error",
    }
}

pub(crate) fn event_type_name(type_: u8) -> String {
    unsafe {
        let ptr = cw_event_type_name(type_);
        if ptr.is_null() {
            "unknown".to_string()
        } else {
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}

pub(crate) fn actor_kind(kind: u8) -> &'static str {
    match kind {
        CW_ACTOR_HUMAN => "human",
        CW_ACTOR_NPC => "npc",
        _ => "unknown",
    }
}

pub(crate) fn actor_status(status: u8) -> &'static str {
    match status {
        CW_ACTOR_ACTIVE => "active",
        CW_ACTOR_KNOCKED_OUT => "knocked_out",
        CW_ACTOR_DEAD => "dead",
        _ => "unknown",
    }
}

pub(crate) fn item_kind(kind: u8) -> &'static str {
    match kind {
        CW_ITEM_POTION => "potion",
        CW_ITEM_EVOLUTION => "evolution",
        CW_ITEM_KEEPSAKE => "trinket",
        _ => "unknown",
    }
}

pub(crate) fn item_role(role: u8) -> &'static str {
    match role {
        CW_ITEM_ROLE_CONSUMABLE => "consumable",
        CW_ITEM_ROLE_WEAPON => "weapon",
        CW_ITEM_ROLE_SKILL_CHARM => "skill_charm",
        CW_ITEM_ROLE_SPELL => "spell",
        CW_ITEM_ROLE_CONTAINER => "container",
        CW_ITEM_ROLE_TOOL => "tool",
        CW_ITEM_ROLE_RELIC => "relic",
        _ => "generic",
    }
}

pub(crate) fn item_size(size_class: u8) -> &'static str {
    match size_class {
        CW_ITEM_SIZE_TINY => "tiny",
        CW_ITEM_SIZE_MEDIUM => "medium",
        CW_ITEM_SIZE_LARGE => "large",
        _ => "small",
    }
}

pub(crate) fn effective_item_weight_tenths(item: CwItem) -> u16 {
    if item.weight_tenths == 0 {
        CW_ITEM_DEFAULT_WEIGHT_TENTHS
    } else {
        item.weight_tenths
    }
}

pub(crate) fn actor_base_carrying_capacity_tenths(actor: CwActor) -> u32 {
    u32::from(actor.stats.strength.max(1) as u8) * 150
}

pub(crate) fn opt_id(value: u64) -> Option<u64> {
    if value == 0 {
        None
    } else {
        Some(value)
    }
}

pub(crate) fn opt_i16(value: i16) -> Option<i16> {
    if value == 0 {
        None
    } else {
        Some(value)
    }
}

pub(crate) fn now_seed() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0xC051_0002)
}

pub(crate) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
pub(crate) fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

pub(crate) fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

pub(crate) fn env_duration_millis(name: &str) -> Duration {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(|millis| Duration::from_millis(millis.min(5_000)))
        .unwrap_or_default()
}

pub(crate) fn generated_asset_dir_from_env() -> PathBuf {
    std::env::var("COSYWORLD_GENERATED_ASSET_DIR")
        .ok()
        .or_else(|| std::env::var("COSYWORLD_V2_GENERATED_ASSET_DIR").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".runtime/generated"))
}

pub(crate) fn generated_avatar_dir(root: &Path) -> PathBuf {
    root.join("avatars")
}

pub(crate) fn stored_avatar_image_path(root: &Path, actor_id: u64) -> PathBuf {
    generated_avatar_dir(root).join(format!("{actor_id}.png"))
}

pub(crate) fn stored_avatar_content_type_path(root: &Path, actor_id: u64) -> PathBuf {
    generated_avatar_dir(root).join(format!("{actor_id}.content-type"))
}

pub(crate) fn stored_avatar_content_type(root: &Path, actor_id: u64) -> String {
    fs::read_to_string(stored_avatar_content_type_path(root, actor_id))
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| is_safe_image_content_type(value))
        .unwrap_or_else(|| "image/png".to_string())
}

pub(crate) fn is_safe_image_content_type(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value.starts_with("image/")
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '+' | '-' | '.'))
}

pub(crate) fn generated_avatar_flavor(actor_id: u64, name: &str) -> (String, String) {
    pub(crate) const TITLES: [&str; 6] = [
        "Hearth-Touched Traveler",
        "Rain-Window Listener",
        "Button-Seeking Guest",
        "Moonlit Errand-Bearer",
        "Quiet Doorway Scout",
        "Story-Spark Wanderer",
    ];
    pub(crate) const TRAITS: [&str; 6] = [
        "arrived with a pocket full of warm lint and unanswered questions",
        "notices small sounds before anyone names them",
        "keeps one hand near the hearth and one eye on the low door",
        "carries the look of someone who remembers rain from another place",
        "has the careful posture of a guest learning the room's rules",
        "seems ready to trade a found thing for a better story",
    ];
    let index = (actor_id as usize) % TITLES.len();
    (
        TITLES[index].to_string(),
        format!("{name} {trait_text}.", trait_text = TRAITS[index]),
    )
}

pub(crate) fn generated_avatar_image_url(actor_id: u64) -> String {
    format!("/assets/generated/avatars/{actor_id}.png")
}

pub(crate) fn generated_avatar_svg(actor_id: u64) -> String {
    pub(crate) const PALETTES: [(&str, &str, &str); 6] = [
        ("#163926", "#65e68a", "#efc96b"),
        ("#1b2f4a", "#8bb7ff", "#f6d879"),
        ("#3b263f", "#d897ff", "#65e68a"),
        ("#3b2f1a", "#efc96b", "#8bb7ff"),
        ("#173b3b", "#75e5d6", "#f29c9c"),
        ("#2f253f", "#bca1ff", "#efc96b"),
    ];
    let hash = actor_id.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    let (bg, cloak, accent) = PALETTES[(hash as usize) % PALETTES.len()];
    let skin = if hash & 1 == 0 { "#d8f7dc" } else { "#c5e3ce" };
    let eye = if hash & 2 == 0 { "#080b09" } else { "#203047" };
    let sigil = match (hash >> 8) % 4 {
        0 => format!(
            "<path d='M160 58l18 35 38 6-28 27 7 38-35-18-35 18 7-38-28-27 38-6z' fill='{accent}' opacity='.95'/>"
        ),
        1 => format!(
            "<circle cx='160' cy='88' r='34' fill='none' stroke='{accent}' stroke-width='10'/><circle cx='160' cy='88' r='9' fill='{accent}'/>"
        ),
        2 => format!(
            "<path d='M118 108c28-52 56-52 84 0M128 82h64M142 56h36' fill='none' stroke='{accent}' stroke-width='10' stroke-linecap='round'/>"
        ),
        _ => format!(
            "<path d='M160 48c30 27 45 54 45 81 0 20-16 35-45 45-29-10-45-25-45-45 0-27 15-54 45-81z' fill='{accent}' opacity='.9'/>"
        ),
    };

    format!(
        "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='480' viewBox='0 0 320 480' role='img' aria-label='Generated CosyWorld avatar'><defs><radialGradient id='glow' cx='50%' cy='16%' r='55%'><stop offset='0' stop-color='{accent}' stop-opacity='.38'/><stop offset='1' stop-color='{bg}' stop-opacity='0'/></radialGradient><linearGradient id='cloak' x1='0' x2='1' y1='0' y2='1'><stop offset='0' stop-color='{cloak}'/><stop offset='1' stop-color='{bg}'/></linearGradient></defs><rect width='320' height='480' rx='22' fill='{bg}'/><rect x='11' y='11' width='298' height='458' rx='18' fill='none' stroke='{accent}' stroke-width='4' opacity='.72'/><rect width='320' height='260' fill='url(#glow)'/>{sigil}<path d='M72 421c15-112 52-171 88-171s73 59 88 171z' fill='url(#cloak)' stroke='{accent}' stroke-width='5'/><circle cx='160' cy='173' r='64' fill='{skin}' stroke='{accent}' stroke-width='6'/><path d='M104 162c20-54 91-71 119-16 7 14 8 31 5 48-16-30-41-47-72-47-22 0-39 6-52 15z' fill='{cloak}'/><circle cx='137' cy='184' r='7' fill='{eye}'/><circle cx='183' cy='184' r='7' fill='{eye}'/><path d='M138 216c16 12 30 12 45 0' fill='none' stroke='{eye}' stroke-width='5' stroke-linecap='round'/><path d='M160 260v145' stroke='{accent}' stroke-width='4' opacity='.65'/><circle cx='160' cy='312' r='13' fill='{accent}'/><path d='M112 356h96' stroke='{accent}' stroke-width='7' stroke-linecap='round' opacity='.78'/><text x='160' y='452' text-anchor='middle' font-family='ui-monospace, SFMono-Regular, Menlo, monospace' font-size='22' font-weight='800' fill='{accent}'>#{actor_id}</text></svg>"
    )
}

pub(crate) fn event_visible_in_location(event: &EventView, location_id: u64) -> bool {
    event.location_id == Some(location_id) || event.destination_location_id == Some(location_id)
}

pub(crate) fn required_health_urls_from_env() -> Vec<String> {
    std::env::var("COSYWORLD_REQUIRED_HEALTH_URLS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_string)
        .collect()
}

pub(crate) async fn required_processes_ready(urls: &[String]) -> Result<(), String> {
    if urls.is_empty() {
        return Ok(());
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| format!("readiness client unavailable: {error}"))?;
    let checks = urls.iter().map(|url| {
        let client = client.clone();
        let url = url.clone();
        async move {
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|error| format!("{url}: {error}"))?;
            if response.status().is_success() {
                Ok(())
            } else {
                Err(format!("{url}: HTTP {}", response.status()))
            }
        }
    });
    let mut tasks = checks.map(|check| tokio::spawn(check)).collect::<Vec<_>>();
    for task in tasks.drain(..) {
        match task.await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(error),
            Err(error) => return Err(format!("tenant readiness check failed: {error}")),
        }
    }
    Ok(())
}

pub(crate) fn seed_item_kind(item: &SeedItemContent) -> Option<u8> {
    seed_item_kind_from_str(&item.kind)
}

pub(crate) fn seed_item_kind_from_str(kind: &str) -> Option<u8> {
    match kind {
        "potion" => Some(CW_ITEM_POTION),
        "evolution" => Some(CW_ITEM_EVOLUTION),
        "trinket" | "keepsake" => Some(CW_ITEM_KEEPSAKE),
        _ => None,
    }
}

pub(crate) fn seed_item_role(item: &SeedItemContent) -> Option<u8> {
    match item.role.as_str() {
        "generic" => Some(CW_ITEM_ROLE_GENERIC),
        "consumable" => Some(CW_ITEM_ROLE_CONSUMABLE),
        "weapon" => Some(CW_ITEM_ROLE_WEAPON),
        "skill_charm" => Some(CW_ITEM_ROLE_SKILL_CHARM),
        "spell" => Some(CW_ITEM_ROLE_SPELL),
        "container" => Some(CW_ITEM_ROLE_CONTAINER),
        "tool" => Some(CW_ITEM_ROLE_TOOL),
        "relic" => Some(CW_ITEM_ROLE_RELIC),
        _ => None,
    }
}

pub(crate) fn seed_item_size(item: &SeedItemContent) -> Option<u8> {
    item_size_from_str(&item.size)
}

pub(crate) fn item_size_from_str(size: &str) -> Option<u8> {
    match size {
        "tiny" => Some(CW_ITEM_SIZE_TINY),
        "small" => Some(CW_ITEM_SIZE_SMALL),
        "medium" => Some(CW_ITEM_SIZE_MEDIUM),
        "large" => Some(CW_ITEM_SIZE_LARGE),
        _ => None,
    }
}

pub(crate) fn default_seed_item_size() -> String {
    "small".to_string()
}

pub(crate) fn default_seed_item_role() -> String {
    "generic".to_string()
}

pub(crate) fn default_seed_item_weight_tenths() -> u16 {
    CW_ITEM_DEFAULT_WEIGHT_TENTHS
}
