// helpers/avatarFilters.mjs -------------------------------------------------

/**
 * Build a MongoDB query from an arbitrary “filters” object.
 *
 * @param {Record<string, any>} filters
 * @returns {Record<string, any>}
 */
export function buildAvatarQuery(filters = {}) {
    const query = {};
  
    for (const [field, spec] of Object.entries(filters)) {
      if (spec === undefined || spec === null) continue;
  
      if (typeof spec === 'object' && !Array.isArray(spec)) {
        // Already a MongoDB operator object: { $gte: … }
        query[field] = spec;
      } else if (Array.isArray(spec)) {
        // Convenience: array → $in
        query[field] = { $in: spec };
      } else {
        // Scalar equality
        query[field] = spec;
      }
    }
  
    return query;
  }
  