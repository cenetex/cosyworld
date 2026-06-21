import { ObjectId } from '../../utils/objectId.mjs';

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function isIsoDateString(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function toComparable(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && typeof value.toHexString === 'function') return value.toHexString();
  if (isIsoDateString(value)) return Date.parse(value);
  return value;
}

function getPath(obj, path) {
  if (!path) return obj;
  const parts = String(path).split('.');
  const walk = (cur, index) => {
    if (index >= parts.length) return cur;
    if (cur == null) return undefined;
    const key = parts[index];

    if (Array.isArray(cur)) {
      if (/^\d+$/.test(key)) return walk(cur[Number(key)], index + 1);
      const values = cur
        .map(item => walk(item, index))
        .filter(value => value !== undefined);
      return values.length ? values.flat() : undefined;
    }

    return walk(cur[key], index + 1);
  };
  return walk(obj, 0);
}

function setPath(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key];
  }
  cur[parts.at(-1)] = value;
}

function unsetPath(obj, path) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur = cur?.[parts[i]];
    if (!cur || typeof cur !== 'object') return;
  }
  delete cur[parts.at(-1)];
}

function valuesEqual(a, b) {
  if (a == null && b == null) return true;
  const av = toComparable(a);
  const bv = toComparable(b);
  if (Array.isArray(av) && Array.isArray(bv)) {
    return av.length === bv.length && av.every((item, index) => valuesEqual(item, bv[index]));
  }
  if (Array.isArray(av)) return av.some(item => valuesEqual(item, bv));
  if (Array.isArray(bv)) return bv.some(item => valuesEqual(av, item));
  return String(av) === String(bv);
}

function compareScalars(actual, operator, wanted) {
  const av = toComparable(actual);
  const bv = toComparable(wanted);
  switch (operator) {
    case '$gt': return av > bv;
    case '$gte': return av >= bv;
    case '$lt': return av < bv;
    case '$lte': return av <= bv;
    default: return false;
  }
}

function compare(value, operator, expected, allOperators = {}) {
  const actual = toComparable(value);
  const wanted = toComparable(expected);
  switch (operator) {
    case '$eq': return valuesEqual(actual, wanted);
    case '$ne': return !valuesEqual(actual, wanted);
    case '$in': return Array.isArray(expected) && expected.some(item => valuesEqual(actual, item));
    case '$nin': return Array.isArray(expected) && !expected.some(item => valuesEqual(actual, item));
    case '$exists': return expected ? actual !== undefined : actual === undefined;
    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte':
      return Array.isArray(value)
        ? value.some(item => compareScalars(item, operator, expected))
        : compareScalars(value, operator, expected);
    case '$regex': {
      const re = expected instanceof RegExp ? expected : new RegExp(String(expected), allOperators.$options || '');
      return re.test(String(actual ?? ''));
    }
    case '$options': return true;
    case '$all':
      return Array.isArray(value)
        && Array.isArray(expected)
        && expected.every(item => value.some(actualItem => valuesEqual(actualItem, item)));
    case '$size':
      return Array.isArray(value) && value.length === Number(expected);
    case '$elemMatch':
      return Array.isArray(value) && value.some(item => matchesQuery(item, expected));
    default: return false;
  }
}

function matchesQuery(doc, query = {}, vars = {}) {
  if (!query || Object.keys(query).length === 0) return true;
  for (const [key, expected] of Object.entries(query)) {
    if (key === '$or') {
      if (!Array.isArray(expected) || !expected.some(part => matchesQuery(doc, part, vars))) return false;
      continue;
    }
    if (key === '$and') {
      if (!Array.isArray(expected) || !expected.every(part => matchesQuery(doc, part, vars))) return false;
      continue;
    }
    if (key === '$nor') {
      if (Array.isArray(expected) && expected.some(part => matchesQuery(doc, part, vars))) return false;
      continue;
    }
    if (key === '$expr') {
      if (!evaluateExpression(expected, doc, vars)) return false;
      continue;
    }

    const actual = getPath(doc, key);
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date) && !(expected instanceof RegExp) && typeof expected.toHexString !== 'function') {
      const opKeys = Object.keys(expected).filter(k => k.startsWith('$'));
      if (opKeys.length) {
        if (!opKeys.every(op => compare(actual, op, expected[op], expected))) return false;
      } else if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        return false;
      }
    } else if (!valuesEqual(actual, expected)) {
      return false;
    }
  }
  return true;
}

function applyProjection(doc, projection, vars = {}) {
  if (!projection || Object.keys(projection).length === 0) return clone(doc);
  const entries = Object.entries(projection);
  const include = entries.some(([, v]) => !!v);
  const explicitId = Object.hasOwn(projection, '_id');
  if (include) {
    const out = {};
    for (const [key, value] of entries) {
      if (value === 0 || value === false) continue;
      const pathValue = (value === 1 || value === true)
        ? getPath(doc, key)
        : evaluateExpression(value, doc, vars);
      if (pathValue !== undefined) setPath(out, key, pathValue);
    }
    if (!explicitId && doc._id !== undefined) out._id = doc._id;
    return out;
  }
  const out = clone(doc);
  for (const [key, value] of entries) {
    if (value === 0) unsetPath(out, key);
  }
  return out;
}

function sortDocs(docs, spec = {}) {
  const entries = Object.entries(spec || {});
  if (!entries.length) return docs;
  return docs.sort((a, b) => {
    for (const [key, dir] of entries) {
      const av = toComparable(getPath(a, key));
      const bv = toComparable(getPath(b, key));
      if (av === bv) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av > bv ? Number(dir || 1) : -Number(dir || 1);
    }
    return 0;
  });
}

function applyUpdate(doc, update = {}, { isInsert = false } = {}) {
  const hasOperators = Object.keys(update).some(k => k.startsWith('$'));
  if (!hasOperators) return { ...clone(update), _id: doc._id };

  const next = clone(doc);
  if (update.$set) {
    for (const [key, value] of Object.entries(update.$set)) setPath(next, key, value);
  }
  if (isInsert && update.$setOnInsert) {
    for (const [key, value] of Object.entries(update.$setOnInsert)) setPath(next, key, value);
  }
  if (update.$unset) {
    for (const key of Object.keys(update.$unset)) unsetPath(next, key);
  }
  if (update.$inc) {
    for (const [key, value] of Object.entries(update.$inc)) setPath(next, key, Number(getPath(next, key) || 0) + Number(value || 0));
  }
  if (update.$push) {
    for (const [key, value] of Object.entries(update.$push)) {
      const current = getPath(next, key);
      let arr = Array.isArray(current) ? [...current] : [];
      if (value && typeof value === 'object' && Array.isArray(value.$each)) {
        const position = Number.isInteger(value.$position) ? value.$position : null;
        if (position === null) arr.push(...value.$each);
        else arr.splice(Math.max(position, 0), 0, ...value.$each);
        if (value.$slice !== undefined) {
          const slice = Number(value.$slice);
          arr = slice >= 0 ? arr.slice(0, slice) : arr.slice(slice);
        }
      } else {
        arr.push(value);
      }
      setPath(next, key, arr);
    }
  }
  if (update.$addToSet) {
    for (const [key, value] of Object.entries(update.$addToSet)) {
      const current = getPath(next, key);
      const arr = Array.isArray(current) ? current : [];
      const values = value && typeof value === 'object' && Array.isArray(value.$each) ? value.$each : [value];
      for (const item of values) {
        if (!arr.some(existing => JSON.stringify(existing) === JSON.stringify(item))) arr.push(item);
      }
      setPath(next, key, arr);
    }
  }
  return next;
}

class SqliteDocumentCursor {
  constructor(docs) {
    this.docs = docs;
    this.index = 0;
  }

  sort(spec) {
    sortDocs(this.docs, spec);
    return this;
  }

  limit(n) {
    this.docs = this.docs.slice(0, Number(n));
    return this;
  }

  skip(n) {
    this.docs = this.docs.slice(Number(n));
    return this;
  }

  project(projection) {
    this.docs = this.docs.map(doc => applyProjection(doc, projection));
    return this;
  }

  async toArray() {
    return clone(this.docs);
  }

  async hasNext() {
    return this.index < this.docs.length;
  }

  async next() {
    if (!(await this.hasNext())) return null;
    const doc = this.docs[this.index];
    this.index += 1;
    return clone(doc);
  }

  async count() {
    return this.docs.length;
  }
}

export class SqliteDocumentCollection {
  constructor({ db, name }) {
    this.db = db;
    this.name = name;
    this.selectAll = db.prepare('SELECT id, doc FROM documents WHERE collection = ?');
    this.selectOne = db.prepare('SELECT doc FROM documents WHERE collection = ? AND id = ?');
    this.upsert = db.prepare(`
      INSERT INTO documents (collection, id, doc, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET
        doc = excluded.doc,
        created_at = COALESCE(documents.created_at, excluded.created_at),
        updated_at = excluded.updated_at
    `);
    this.deleteById = db.prepare('DELETE FROM documents WHERE collection = ? AND id = ?');
  }

  _idString(id) {
    if (id == null) return new ObjectId().toHexString();
    if (typeof id?.toHexString === 'function') return id.toHexString();
    return String(id);
  }

  _allDocs() {
    return this.selectAll.all(this.name).map(row => JSON.parse(row.doc));
  }

  _write(doc, createdAt = null) {
    const id = this._idString(doc._id);
    const now = new Date().toISOString();
    const existing = this.selectOne.get(this.name, id);
    this.upsert.run(this.name, id, JSON.stringify(doc), createdAt || (existing ? null : now), now);
  }

  async createIndex() {
    return null;
  }

  async createIndexes() {
    return [];
  }

  async indexes() {
    return [];
  }

  find(query = {}, options = {}) {
    let docs = this._allDocs().filter(doc => matchesQuery(doc, query));
    if (options.sort) docs = sortDocs(docs, options.sort);
    if (options.projection) docs = docs.map(doc => applyProjection(doc, options.projection));
    if (options.limit) docs = docs.slice(0, Number(options.limit));
    return new SqliteDocumentCursor(docs);
  }

  async findOne(query = {}, options = {}) {
    const docs = await this.find(query, options).limit(1).toArray();
    return docs[0] || null;
  }

  async insertOne(doc = {}) {
    const next = clone(doc);
    if (next._id == null) next._id = new ObjectId().toHexString();
    this._write(next);
    return { acknowledged: true, insertedId: next._id };
  }

  async insertMany(docs = []) {
    const insertedIds = {};
    const tx = this.db.transaction(() => {
      docs.forEach((doc, index) => {
        const next = clone(doc);
        if (next._id == null) next._id = new ObjectId().toHexString();
        this._write(next);
        insertedIds[index] = next._id;
      });
    });
    tx();
    return { acknowledged: true, insertedCount: docs.length, insertedIds };
  }

  async updateOne(filter, update, options = {}) {
    const existing = await this.findOne(filter);
    if (existing) {
      const next = applyUpdate(existing, update);
      this._write(next);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null };
    }
    if (!options.upsert) {
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
    }
    const seed = {};
    for (const [key, value] of Object.entries(filter || {})) {
      if (!key.startsWith('$') && !(value && typeof value === 'object' && Object.keys(value).some(k => k.startsWith('$')))) {
        setPath(seed, key, value);
      }
    }
    if (seed._id == null) seed._id = new ObjectId().toHexString();
    const next = applyUpdate(seed, update, { isInsert: true });
    this._write(next);
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: next._id };
  }

  async updateMany(filter, update, options = {}) {
    const docs = await this.find(filter).toArray();
    if (!docs.length && options.upsert) {
      return await this.updateOne(filter, update, options);
    }
    for (const doc of docs) {
      this._write(applyUpdate(doc, update));
    }
    return { acknowledged: true, matchedCount: docs.length, modifiedCount: docs.length, upsertedCount: 0, upsertedId: null };
  }

  async findOneAndUpdate(filter, update, options = {}) {
    const before = await this.findOne(filter);
    const result = await this.updateOne(filter, update, { upsert: !!options.upsert });
    const after = before ? await this.findOne({ _id: before._id }) : (result.upsertedId ? await this.findOne({ _id: result.upsertedId }) : null);
    return { value: options.returnDocument === 'after' || options.returnOriginal === false ? after : before };
  }

  async replaceOne(filter, replacement, options = {}) {
    const existing = await this.findOne(filter);
    if (existing) {
      const next = { ...clone(replacement), _id: replacement._id ?? existing._id };
      this._write(next);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
    if (!options.upsert) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    const next = { ...clone(replacement), _id: replacement._id ?? new ObjectId().toHexString() };
    this._write(next);
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: next._id };
  }

  async deleteOne(filter = {}) {
    const doc = await this.findOne(filter);
    if (!doc) return { acknowledged: true, deletedCount: 0 };
    this.deleteById.run(this.name, this._idString(doc._id));
    return { acknowledged: true, deletedCount: 1 };
  }

  async deleteMany(filter = {}) {
    const docs = await this.find(filter).toArray();
    const tx = this.db.transaction(() => {
      for (const doc of docs) this.deleteById.run(this.name, this._idString(doc._id));
    });
    tx();
    return { acknowledged: true, deletedCount: docs.length };
  }

  async dropIndex() {
    return { acknowledged: true };
  }

  async countDocuments(filter = {}) {
    return (await this.find(filter).toArray()).length;
  }

  async distinct(field, filter = {}) {
    const docs = await this.find(filter).toArray();
    return [...new Set(docs.map(doc => getPath(doc, field)).filter(value => value !== undefined))];
  }

  async bulkWrite(operations = []) {
    let insertedCount = 0;
    let modifiedCount = 0;
    let deletedCount = 0;
    let upsertedCount = 0;
    for (const op of operations) {
      if (op.insertOne) {
        await this.insertOne(op.insertOne.document);
        insertedCount += 1;
      } else if (op.updateOne) {
        const res = await this.updateOne(op.updateOne.filter, op.updateOne.update, { upsert: op.updateOne.upsert });
        modifiedCount += res.modifiedCount || 0;
        upsertedCount += res.upsertedCount || 0;
      } else if (op.replaceOne) {
        const res = await this.replaceOne(op.replaceOne.filter, op.replaceOne.replacement, { upsert: op.replaceOne.upsert });
        modifiedCount += res.modifiedCount || 0;
        upsertedCount += res.upsertedCount || 0;
      } else if (op.deleteOne) {
        deletedCount += (await this.deleteOne(op.deleteOne.filter)).deletedCount;
      } else if (op.deleteMany) {
        deletedCount += (await this.deleteMany(op.deleteMany.filter)).deletedCount;
      }
    }
    return { acknowledged: true, insertedCount, modifiedCount, deletedCount, upsertedCount };
  }

  aggregate(pipeline = [], _options = {}) {
    const docs = this._aggregateDocs(this._allDocs(), pipeline);
    return new SqliteDocumentCursor(docs);
  }

  _aggregateDocs(inputDocs = [], pipeline = [], vars = {}) {
    let docs = inputDocs.map(doc => clone(doc));
    for (const stage of pipeline) {
      if (Object.hasOwn(stage, '$match')) docs = docs.filter(doc => matchesQuery(doc, stage.$match, vars));
      else if (Object.hasOwn(stage, '$sort')) docs = sortDocs(docs, stage.$sort);
      else if (Object.hasOwn(stage, '$limit')) docs = docs.slice(0, Number(stage.$limit));
      else if (Object.hasOwn(stage, '$skip')) docs = docs.slice(Number(stage.$skip));
      else if (Object.hasOwn(stage, '$sample')) docs = docs.sort(() => Math.random() - 0.5).slice(0, Number(stage.$sample.size || 1));
      else if (Object.hasOwn(stage, '$project')) docs = docs.map(doc => applyProjection(doc, stage.$project, vars));
      else if (Object.hasOwn(stage, '$count')) docs = [{ [stage.$count]: docs.length }];
      else if (Object.hasOwn(stage, '$group')) docs = groupDocs(docs, stage.$group, vars);
      else if (Object.hasOwn(stage, '$addFields') || Object.hasOwn(stage, '$set')) docs = addFields(docs, stage.$addFields || stage.$set, vars);
      else if (Object.hasOwn(stage, '$lookup')) docs = this.lookupDocs(docs, stage.$lookup, vars);
      else if (Object.hasOwn(stage, '$unwind')) docs = unwindDocs(docs, stage.$unwind);
      else if (Object.hasOwn(stage, '$facet')) {
        docs = [
          Object.fromEntries(
            Object.entries(stage.$facet).map(([key, subPipeline]) => [
              key,
              this._aggregateDocs(docs, subPipeline, vars)
            ])
          )
        ];
      } else {
        throw new Error(`Unsupported SQLite aggregate stage: ${Object.keys(stage).join(', ')}`);
      }
    }
    return docs;
  }

  lookupDocs(docs, lookup, vars = {}) {
    const foreignCollection = new SqliteDocumentCollection({ db: this.db, name: lookup.from });
    const foreignDocs = foreignCollection._allDocs();

    return docs.map(doc => {
      const next = clone(doc);
      let matches = foreignDocs;

      if (lookup.localField && lookup.foreignField) {
        const localValue = getPath(doc, lookup.localField);
        matches = matches.filter(foreignDoc => valuesEqual(getPath(foreignDoc, lookup.foreignField), localValue));
      }

      if (Array.isArray(lookup.pipeline)) {
        const lookupVars = { ...vars };
        for (const [key, expr] of Object.entries(lookup.let || {})) {
          lookupVars[key] = evaluateExpression(expr, doc, { ...vars, ROOT: doc });
        }
        matches = foreignCollection._aggregateDocs(matches, lookup.pipeline, lookupVars);
      } else {
        matches = matches.map(item => clone(item));
      }

      setPath(next, lookup.as, matches);
      return next;
    });
  }
}

function addFields(docs, spec, vars = {}) {
  return docs.map(doc => {
    const next = clone(doc);
    for (const [key, expr] of Object.entries(spec || {})) {
      setPath(next, key, evaluateExpression(expr, next, { ...vars, ROOT: next }));
    }
    return next;
  });
}

function unwindDocs(docs, spec) {
  const path = typeof spec === 'string' ? spec : spec?.path;
  const preserve = !!(typeof spec === 'object' && spec.preserveNullAndEmptyArrays);
  const field = String(path || '').replace(/^\$/, '');
  if (!field) return docs;

  const out = [];
  for (const doc of docs) {
    const value = getPath(doc, field);
    if (Array.isArray(value) && value.length) {
      for (const item of value) {
        const next = clone(doc);
        setPath(next, field, item);
        out.push(next);
      }
    } else if (preserve) {
      out.push(clone(doc));
    }
  }
  return out;
}

function groupDocs(docs, spec, vars = {}) {
  const groups = new Map();
  const idExpr = spec._id;
  for (const doc of docs) {
    const id = evaluateExpression(idExpr, doc, { ...vars, ROOT: doc });
    const key = JSON.stringify(id);
    if (!groups.has(key)) groups.set(key, { doc: { _id: id }, avg: {} });
    const state = groups.get(key);
    const out = state.doc;
    for (const [field, expr] of Object.entries(spec)) {
      if (field === '_id') continue;
      if (expr.$sum !== undefined) out[field] = Number(out[field] || 0) + numericValue(evaluateExpression(expr.$sum, doc, { ...vars, ROOT: doc }));
      if (expr.$first !== undefined && out[field] === undefined) out[field] = evaluateExpression(expr.$first, doc, { ...vars, ROOT: doc });
      if (expr.$last !== undefined) out[field] = evaluateExpression(expr.$last, doc, { ...vars, ROOT: doc });
      if (expr.$push !== undefined) {
        if (!Array.isArray(out[field])) out[field] = [];
        out[field].push(evaluateExpression(expr.$push, doc, { ...vars, ROOT: doc }));
      }
      if (expr.$max !== undefined) {
        const value = evaluateExpression(expr.$max, doc, { ...vars, ROOT: doc });
        if (out[field] === undefined || toComparable(value) > toComparable(out[field])) out[field] = value;
      }
      if (expr.$min !== undefined) {
        const value = evaluateExpression(expr.$min, doc, { ...vars, ROOT: doc });
        if (out[field] === undefined || toComparable(value) < toComparable(out[field])) out[field] = value;
      }
      if (expr.$avg !== undefined) {
        const value = numericValue(evaluateExpression(expr.$avg, doc, { ...vars, ROOT: doc }));
        if (!state.avg[field]) state.avg[field] = { total: 0, count: 0 };
        state.avg[field].total += value;
        state.avg[field].count += 1;
      }
    }
  }
  return [...groups.values()].map(state => {
    for (const [field, avg] of Object.entries(state.avg)) {
      state.doc[field] = avg.count ? avg.total / avg.count : null;
    }
    return state.doc;
  });
}

function numericValue(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + numericValue(item), 0);
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function resolveVariable(ref, vars) {
  const [name, ...pathParts] = String(ref).split('.');
  const base = name === 'ROOT' ? vars.ROOT : vars[name];
  return pathParts.length ? getPath(base, pathParts.join('.')) : base;
}

function evaluateExpression(expr, doc, vars = {}) {
  if (typeof expr === 'string') {
    if (expr === '$$ROOT') return clone(vars.ROOT || doc);
    if (expr.startsWith('$$')) return resolveVariable(expr.slice(2), { ...vars, ROOT: vars.ROOT || doc });
    if (expr.startsWith('$')) return getPath(doc, expr.slice(1));
    return expr;
  }
  if (Array.isArray(expr)) return expr.map(item => evaluateExpression(item, doc, vars));
  if (!expr || typeof expr !== 'object' || expr instanceof Date || typeof expr.toHexString === 'function') return expr;

  const entries = Object.entries(expr);
  if (entries.length === 1 && entries[0][0].startsWith('$')) {
    const [op, value] = entries[0];
    switch (op) {
      case '$literal': return value;
      case '$eq':
      case '$ne':
      case '$gt':
      case '$gte':
      case '$lt':
      case '$lte': {
        const [left, right] = value;
        return compare(evaluateExpression(left, doc, vars), op, evaluateExpression(right, doc, vars));
      }
      case '$and':
        return Array.isArray(value) && value.every(item => !!evaluateExpression(item, doc, vars));
      case '$or':
        return Array.isArray(value) && value.some(item => !!evaluateExpression(item, doc, vars));
      case '$not':
        return !evaluateExpression(Array.isArray(value) ? value[0] : value, doc, vars);
      case '$toLower':
        return String(evaluateExpression(value, doc, vars) ?? '').toLowerCase();
      case '$ifNull': {
        const [primary, fallback] = value;
        const resolved = evaluateExpression(primary, doc, vars);
        return resolved === null || resolved === undefined ? evaluateExpression(fallback, doc, vars) : resolved;
      }
      case '$cond': {
        const condition = Array.isArray(value) ? value[0] : value.if;
        const thenExpr = Array.isArray(value) ? value[1] : value.then;
        const elseExpr = Array.isArray(value) ? value[2] : value.else;
        return evaluateExpression(condition, doc, vars)
          ? evaluateExpression(thenExpr, doc, vars)
          : evaluateExpression(elseExpr, doc, vars);
      }
      case '$size': {
        const resolved = evaluateExpression(value, doc, vars);
        return Array.isArray(resolved) ? resolved.length : 0;
      }
      case '$arrayElemAt': {
        const [arrayExpr, indexExpr] = value;
        const array = evaluateExpression(arrayExpr, doc, vars);
        const index = Number(evaluateExpression(indexExpr, doc, vars));
        if (!Array.isArray(array)) return undefined;
        return array[index < 0 ? array.length + index : index];
      }
      case '$slice': {
        const args = Array.isArray(value) ? value : [value];
        const array = evaluateExpression(args[0], doc, vars);
        if (!Array.isArray(array)) return [];
        if (args.length === 2) {
          const count = Number(evaluateExpression(args[1], doc, vars));
          return count >= 0 ? array.slice(0, count) : array.slice(count);
        }
        const start = Number(evaluateExpression(args[1], doc, vars));
        const count = Number(evaluateExpression(args[2], doc, vars));
        return array.slice(start, start + count);
      }
      case '$substr':
      case '$substrBytes': {
        const [source, start, length] = value;
        return String(evaluateExpression(source, doc, vars) ?? '').slice(
          Number(evaluateExpression(start, doc, vars)),
          Number(evaluateExpression(start, doc, vars)) + Number(evaluateExpression(length, doc, vars))
        );
      }
      case '$filter': {
        const input = evaluateExpression(value.input, doc, vars);
        const as = value.as || 'this';
        if (!Array.isArray(input)) return [];
        return input.filter(item => evaluateExpression(value.cond, doc, { ...vars, [as]: item, this: item, ROOT: vars.ROOT || doc }));
      }
      case '$map': {
        const input = evaluateExpression(value.input, doc, vars);
        const as = value.as || 'this';
        if (!Array.isArray(input)) return [];
        return input.map(item => evaluateExpression(value.in, doc, { ...vars, [as]: item, this: item, ROOT: vars.ROOT || doc }));
      }
      case '$sum':
        return numericValue(evaluateExpression(value, doc, vars));
      case '$max': {
        const resolved = evaluateExpression(value, doc, vars);
        const values = Array.isArray(resolved) ? resolved : [resolved];
        return values.reduce((max, item) => (max === undefined || toComparable(item) > toComparable(max) ? item : max), undefined);
      }
      case '$min': {
        const resolved = evaluateExpression(value, doc, vars);
        const values = Array.isArray(resolved) ? resolved : [resolved];
        return values.reduce((min, item) => (min === undefined || toComparable(item) < toComparable(min) ? item : min), undefined);
      }
      case '$concatArrays':
        return value.flatMap(item => {
          const resolved = evaluateExpression(item, doc, vars);
          return Array.isArray(resolved) ? resolved : [];
        });
      case '$sortArray': {
        const input = evaluateExpression(value.input, doc, vars);
        return Array.isArray(input) ? sortDocs([...input], value.sortBy || {}) : [];
      }
      case '$dateToString':
        return formatDate(value.format || '%Y-%m-%dT%H:%M:%S.%LZ', evaluateExpression(value.date, doc, vars));
      default:
        return Object.fromEntries(entries.map(([key, child]) => [key, evaluateExpression(child, doc, vars)]));
    }
  }

  return Object.fromEntries(entries.map(([key, value]) => [key, evaluateExpression(value, doc, vars)]));
}

function formatDate(format, value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return String(format)
    .replace(/%Y/g, String(date.getUTCFullYear()))
    .replace(/%m/g, pad(date.getUTCMonth() + 1))
    .replace(/%d/g, pad(date.getUTCDate()))
    .replace(/%H/g, pad(date.getUTCHours()))
    .replace(/%M/g, pad(date.getUTCMinutes()))
    .replace(/%S/g, pad(date.getUTCSeconds()))
    .replace(/%L/g, pad(date.getUTCMilliseconds(), 3));
}

export class SqliteDocumentDatabase {
  constructor({ sqliteConnection, logger } = {}) {
    this.connection = sqliteConnection;
    this.logger = logger || console;
    this.db = this.connection.connect();
    this.collections = new Map();
  }

  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new SqliteDocumentCollection({ db: this.db, name }));
    }
    return this.collections.get(name);
  }

  getCollection(name) {
    return this.collection(name);
  }

  async createCollection(name) {
    return this.collection(name);
  }

  listCollections() {
    const rows = this.db.prepare('SELECT DISTINCT collection AS name FROM documents ORDER BY collection').all();
    return {
      async toArray() {
        return rows.map(row => ({ name: row.name }));
      }
    };
  }
}
