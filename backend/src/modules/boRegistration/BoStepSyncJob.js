const NotificationJob = require('../../core/NotificationJob');

// BO database (step 9 reached) -> our database -> WhatsApp / SMS / email with the PDF link.
class BoStepSyncJob extends NotificationJob {
  constructor({ syncSince = null, ...opts }) {
    super(opts);
    this.syncSince = syncSince; // optional first-run cut-off so old history isn't copied
  }

  async syncSource() {
    const repo = this.repository;
    const since = (await repo.getLastStepDate()) || this.syncSince;

    // 1) copy new step-9 registrations, each with a fresh url code
    const rows = await repo.fetchStep9FromSource(since);
    let stored = 0;
    for (const row of rows) {
      try {
        await this.withNewCode(row.BORegistrationNo || row.BORegistrationMasterID, async (code) => {
          stored += await repo.insertRow({ ...row, UrlCode: code });
        });
      } catch (err) {
        console.error(`[${this.name} SYNC] insert failed for`, row.BORegistrationMasterID, err.message);
      }
    }

    // 2) a url code for any stored row that still has none (older rows)
    let codesAdded = 0;
    for (const r of await repo.findWithoutUrlCode()) {
      try {
        if (await this.withNewCode(r.Id, (code) => repo.setUrlCode(r.Id, code))) codesAdded++;
      } catch (err) {
        console.error(`[${this.name} SYNC] url code failed for`, r.Id, err.message);
      }
    }
    if (stored || codesAdded) console.log(`[${this.name} SYNC] fetched ${rows.length}, stored ${stored}, url codes added ${codesAdded}`);
    return { fetched: rows.length, stored, codesAdded };
  }

  buildRecipient(row) {
    return { mobile: row.CellNo, email: row.Email, name: row.BORegistrationNo || '' };
  }

  buildData(row) {
    return { url: this.link(row.UrlCode) };
  }

  buildMeta(row) {
    return { encryptoCode: row.UrlCode, resolvedCode: String(row.BORegistrationNo || row.Id) };
  }
}

module.exports = BoStepSyncJob;
