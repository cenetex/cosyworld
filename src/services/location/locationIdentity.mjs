import { ObjectId } from 'mongodb';

export function isMongoObjectIdString(value) {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
}

/**
 * Resolve a "location identity" into both:
 * - `locationChannelId`: the Discord channel/thread id string used by gameplay systems
 * - `locationDocId`: the Mongo `locations._id` used by narrative/story systems
 *
 * This helps bridge older code that used `locationId` ambiguously.
 */
export async function resolveLocationIdentity({ locationService, locationRef } = {}) {
  if (!locationRef) {
    return { locationChannelId: null, locationDocId: null, locationDoc: null };
  }

  let locationChannelId = null;
  let locationDocId = null;
  let locationDoc = null;

  // Treat 24-hex strings / ObjectId as locations._id
  if (locationRef instanceof ObjectId || isMongoObjectIdString(locationRef)) {
    try {
      locationDocId = locationRef instanceof ObjectId ? locationRef : new ObjectId(locationRef);
      if (locationService?.getLocationById) {
        locationDoc = await locationService.getLocationById(locationDocId);
      }
      locationChannelId = locationDoc?.channelId || null;
    } catch {
      // ignore
    }

    return { locationChannelId, locationDocId, locationDoc };
  }

  // Otherwise treat it as a channel/thread id
  locationChannelId = String(locationRef);
  try {
    if (locationService?.getLocationByChannelId) {
      locationDoc = await locationService.getLocationByChannelId(locationChannelId);
    }
  } catch {
    // ignore
  }
  locationDocId = locationDoc?._id || null;

  return { locationChannelId, locationDocId, locationDoc };
}
