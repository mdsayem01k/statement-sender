const AuditLogRepository = require('../models/AuditLog.model');
const { parseUserAgent } = require('../utils/uaParser');

// Never throws: a failing audit write must not break sending or serving a PDF.
class AuditService {
  constructor(repository = new AuditLogRepository()) {
    this.repository = repository;
  }

  async save(entry) {
    try {
      const { device, os, browser } = parseUserAgent(entry.userAgent);
      await this.repository.insert({ ...entry, device, os, browser });
    } catch (err) {
      console.error('[AUDIT DB ERROR] Failed to record log entry:', err.message);
    }
  }

  list({ resolvedCode, date }) {
    return this.repository.find({ resolvedCode, date });
  }
}

module.exports = AuditService;
