const NotificationJob = require('../../core/NotificationJob');

function formatSubmissionTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error('BO submission StepDate is missing or invalid');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = date.getUTCHours();
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ||${hours % 12 || 12}:${minute}${hours >= 12 ? 'PM' : 'AM'}`;
}

class BoStepSyncJob extends NotificationJob {
  constructor({ syncSince = null, ...opts }) {
    super(opts);
    this.syncSince = syncSince || this.notifySince;
    if (!this.syncSince) throw new Error('BO synchronization requires a starting date');
    this.notifyRm = false;
    this.notifyGroup = false;
  }

  async syncSource() {
    const repo = this.repository;
    const rows = await repo.fetchStep9FromSource(this.syncSince);
    const existing = await repo.getExistingMasterIds(rows.map(row => row.BORegistrationMasterID));
    let stored = 0;
    let alreadySynced = 0;
    let failed = 0;
    for (const row of rows) {
      if (existing.has(row.BORegistrationMasterID)) { alreadySynced++; continue; }
      try {
        const completed = await this.withNewCode(row.BORegistrationNo || row.BORegistrationMasterID, async code => {
          const inserted = await repo.insertRow({ ...row, UrlCode: code });
          stored += inserted;
          if (!inserted) alreadySynced++;
        });
        if (!completed) failed++;
      } catch (error) {
        failed++;
        console.error(`[${this.name} SYNC] insert failed for ${row.BORegistrationMasterID}:`, error.message);
      }
    }
    let codesAdded = 0;
    for (const row of await repo.findWithoutUrlCode()) {
      try {
        await this.withNewCode(row.Id, async code => {
          if (await repo.setUrlCode(row.Id, code)) codesAdded++;
        });
      } catch (error) {
        failed++;
        console.error(`[${this.name} SYNC] URL code failed for ${row.Id}:`, error.message);
      }
    }
    const summary = { fetched: rows.length, stored, alreadySynced, codesAdded, failed };
    console.log(`[${this.name} SYNC]`, summary);
    return summary;
  }

  buildRecipient(row) {
    return {
      mobile: String(row.CellNo || '').split(',')[0].trim(),
      email: String(row.Email || '').split(',')[0].trim(),
      name: row.BORegistrationNo || ''
    };
  }

  buildData(row) {
    return {
      url: this.link(row.UrlCode),
      dateTime: formatSubmissionTime(row.StepDate)
    };
  }

  buildMeta(row) {
    return { encryptoCode: row.UrlCode, resolvedCode: String(row.BORegistrationNo || row.Id) };
  }
}

module.exports = BoStepSyncJob;
