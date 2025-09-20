// AuditLogService: append-only security and admin action log
export class AuditLogService {
  constructor({ db, logger, collection = 'admin_audit_log' } = {}) {
    this.db = db;
    this.logger = logger;
    this.collectionName = collection;
    this.initialized = false;
  }

  async _col() {
    if (!this.db) throw new Error('AuditLogService missing db');
    if (!this.initialized) {
      try {
        await this.db.createCollection(this.collectionName).catch(() => {});
        await this.db.collection(this.collectionName).createIndex({ ts: -1 });
        await this.db.collection(this.collectionName).createIndex({ action: 1 });
        this.initialized = true;
      } catch (e) {
        this.logger?.warn?.('AuditLogService init failed:', e.message);
      }
    }
    return this.db.collection(this.collectionName);
  }

  /**
   * Write an audit event.
   * @param {Object} entry
   * @param {string} entry.action - canonical action string e.g. 'xauth.request'
   * @param {string} [entry.actor] - wallet / user id / system
   * @param {string} [entry.ip]
   * @param {string} [entry.status] - success|fail|error
   * @param {Object} [entry.details] - additional structured data (non-PII)
   */
  async log({ action, actor, ip, status = 'success', details = {} } = {}) {
    if (!action) return;
    try {
      const col = await this._col();
      const doc = { action, actor, ip, status, details, ts: new Date() };
      await col.insertOne(doc);
      this.logger?.debug?.(`[audit] ${action} actor=${actor || 'n/a'} status=${status}`);
    } catch (e) {
      this.logger?.warn?.(`Audit log write failed: ${e.message}`);
    }
  }
}

export default AuditLogService;
