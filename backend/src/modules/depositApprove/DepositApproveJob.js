const DepositReqNotificationJob = require('../depositReq/DepositReqNotificationJob');

class DepositApproveJob extends DepositReqNotificationJob {
  async syncSource() {
    const repo = this.repository;
    const rows = await repo.fetchNewFromSource();
    let stored = 0;
    let failed = 0;
    let created = 0;
    for (const row of rows) {
      try {
        stored += await repo.insertSyncRow(row);
      } catch (error) {
        failed++;
        console.error(`[${this.name} SYNC] ${row.SourcePaymentID}:`, error.message);
      }
    }
    for (const row of await repo.findWithoutNotification()) {
      try {
        const ok = await this.withNewCode(row.InvestorCode || row.SourceId, code =>
          repo.insertNotification({ ...row, UrlCode: code }));
        if (ok) created++;
      } catch (error) {
        failed++;
        console.error(`[${this.name} SYNC] notification ${row.SourceId}:`, error.message);
      }
    }
    const stats = { fetched: rows.length, stored, created, failed };
    console.log(`[${this.name} SYNC]`, stats);
    return stats;
  }

  buildData(row) {
    const data = super.buildData(row);
    return {
      ...data,
      paymentDate: data.dateTime.split(' ||')[0],
      paymentMode: row.Descriptions || ''
    };
  }
}

module.exports = DepositApproveJob;
