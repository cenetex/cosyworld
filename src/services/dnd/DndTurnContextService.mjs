import { resolveLocationIdentity } from '../location/locationIdentity.mjs';
import { buildDungeonActionRows } from './dungeonActions.mjs';

export class DndTurnContextService {
  constructor({ databaseService, dungeonService, partyService, locationService, channelSummaryService, logger }) {
    this.databaseService = databaseService;
    this.dungeonService = dungeonService;
    this.partyService = partyService;
    this.locationService = locationService;
    this.channelSummaryService = channelSummaryService;
    this.logger = logger || console;
  }

  async _db() {
    return this.databaseService?.getDatabase?.();
  }

  /**
   * Build a canonical turn context object for dungeon UX.
   * The key contract is `locationChannelId` (Discord channel/thread id).
   */
  async buildForDungeon({ dungeon, channelId = null, avatarId = null } = {}) {
    let dungeonDoc = dungeon;

    if (dungeon && (typeof dungeon === 'string' || dungeon?._bsontype === 'ObjectId')) {
      dungeonDoc = await this.dungeonService?.getDungeon?.(dungeon);
    }

    if (!dungeonDoc) {
      return {
        dungeon: null,
        room: null,
        locationChannelId: channelId,
        locationDoc: null,
        party: null,
        localItems: [],
        channelSummary: null,
        actions: [],
        components: []
      };
    }

    const locationChannelId = dungeonDoc.locationChannelId || dungeonDoc.threadId || dungeonDoc.channelId || channelId || null;

    const { locationDocId, locationDoc } = await resolveLocationIdentity({
      locationService: this.locationService,
      locationRef: locationChannelId || dungeonDoc.locationDocId || dungeonDoc.locationId
    });

    // Party
    let party = null;
    try {
      const partyId = dungeonDoc.partyId?.toString?.() || dungeonDoc.partyId;
      if (partyId && this.partyService?.getParty) {
        party = await this.partyService.getParty(partyId);
      }
    } catch (e) {
      this.logger?.debug?.(`[DndTurnContext] Party lookup failed: ${e.message}`);
    }

    // Room
    const room = dungeonDoc.rooms?.find?.(r => r.id === dungeonDoc.currentRoom) || null;

    // Local items (best-effort)
    let localItems = [];
    try {
      if (locationChannelId) {
        const db = await this._db();
        if (db) {
          localItems = await db.collection('items')
            .find({ locationId: locationChannelId, owner: null })
            .sort({ updatedAt: -1, createdAt: -1 })
            .limit(20)
            .toArray();
        }
      }
    } catch (e) {
      this.logger?.debug?.(`[DndTurnContext] Local items query failed: ${e.message}`);
    }

    // Channel summary (best-effort)
    let channelSummary = null;
    try {
      if (this.channelSummaryService?.getChannelSummary && locationChannelId) {
        channelSummary = await this.channelSummaryService.getChannelSummary('discord', locationChannelId);
      }
    } catch (e) {
      this.logger?.debug?.(`[DndTurnContext] Channel summary lookup failed: ${e.message}`);
    }

    const components = buildDungeonActionRows({ room, dungeon: dungeonDoc });

    return {
      dungeon: dungeonDoc,
      room,
      locationChannelId,
      locationDocId,
      locationDoc,
      party,
      localItems,
      channelSummary,
      components
    };
  }
}
