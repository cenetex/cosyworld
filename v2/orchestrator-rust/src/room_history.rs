use super::*;

// Public speech and story beats are the room's history. Worker progress, hand
// refreshes and other temporary activity keep the ordinary replay retention.
pub(super) const EVENT_TYPES: &str = "'message.created', 'image.created',
    'model_interaction.output', 'avatar.thought', 'avatar.dream',
    'actor.moved', 'journey.started', 'journey.progressed', 'journey.narrated',
    'journey.completed', 'journey.backtracked', 'journey.paused',
    'pathway.discovered', 'pathway.familiarized',
    'relationship.beat', 'relationship.advanced', 'ability_check.rolled',
    'study.resolved', 'feature.searched', 'location.searched', 'exit.discovered',
    'avatar.discovered', 'item.found', 'item.picked_up', 'item.dropped',
    'item.used', 'item.given', 'item.traded', 'job.contribution.resolved',
    'first_tale.public_trace', 'clock.updated', 'clock.threshold',
    'natural_feature.revealed', 'job.updated', 'story.receipt', 'ledger.banked',
    'calling.revised', 'skill.stepped', 'bond.created', 'bond.revised', 'bond.resolved',
    'combat.attack.attempt', 'combat.attack.hit', 'combat.attack.miss',
    'combat.defend', 'combat.dodge', 'combat.pass', 'combat.need_time',
    'combat.knockout', 'combat.flee.success', 'combat.encounter.started',
    'combat.encounter.resolved', 'magic.spell_cast', 'world.weather.shifted',
    'world.weather.held', 'world.trade.flowed', 'world.trade.disrupted',
    'world.delivery.needed', 'world.logistics.completed',
    'world.faction.influence_shifted', 'world.conflict.pressure_grew',
    'world.conflict.pressure_eased', 'world.conflict.escalated'";

pub(super) fn initialize_index(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(&format!(
        "CREATE INDEX IF NOT EXISTS idx_room_history
         ON world_events(world_id, world_epoch, location_id, seq)
         WHERE event_type IN ({EVENT_TYPES});"
    ))
    .map_err(sqlite_error)
}
