const NotificationJob = require('../../core/NotificationJob');
const { parseDescription } = require('./parseDescription');

const last10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);   // 8801711111111 and 01711111111 are the same phone

// sync from the source table -> create notification rows with url codes -> send (core/NotificationJob does the sending)
class ReceiptNotificationJob extends NotificationJob {
  // notifyRm: also send the same message to the investor's RM (RmMobile / RmEmail copied at sync time)
  constructor({ notifyRm = false, ...opts }) {
    super(opts);
    this.notifyRm = notifyRm;
  }

  async syncSource() {
    const repo = this.repository;

    // 1) copy new rows from the source database
    const rows = await repo.fetchNewFromSource(await repo.getLastSourceId());
    let stored = 0;
    for (const row of rows) stored += await repo.insertSyncRow(row);

    // 2) a notification row (with url code) for every row that lacks one
    let created = 0;
    for (const c of await repo.findWithoutNotification()) {
      try {
        const ok = await this.withNewCode(c.InvestorCode || c.SourceId, (code) =>
          repo.insertNotification({ ...c, UrlCode: code }));
        if (ok) created++;
      } catch (err) {
        console.error(`[${this.name} SYNC] notification failed for`, c.SourceId, err.message);
      }
    }
    console.log(`[${this.name} SYNC] fetched ${rows.length}, stored ${stored}, notifications ${created}`);
    return { fetched: rows.length, stored, created };
  }

  buildRecipient(row) {
    return { mobile: row.CellNo, email: row.Email, name: parseDescription(row.Descriptions).name };
  }

  // investor first, then the RM when that RM has a number / address different from the investor's
  buildRecipients(row) {
    console.log('receipt-notification job: ',this.notifyRm);
    const investor = { role: 'INVESTOR', ...this.buildRecipient(row) };
    if (!this.notifyRm) return [investor];

    const sameMobile = last10(investor.mobile) && last10(row.RmMobile) === last10(investor.mobile);
    const sameEmail = investor.email && String(row.RmEmail || '').toLowerCase() === String(investor.email).toLowerCase();
    const rm = {
      role: 'RM',
      name: investor.name,                       // the template talks about the investor
      mobile: sameMobile ? null : row.RmMobile || null,
      email: sameEmail ? null : row.RmEmail || null,
    };
    console.log('rm mobile:',rm.mobile);
    return rm.mobile || rm.email ? [investor, rm] : [investor];   // no RM contact = skip quietly, no retry counted
  }

 buildData(row) {
  return {
    amount: Number(row.Amount || 0).toFixed(2),
    url: this.link(row.UrlCode),
    Investor: row.InvestorCode || '',
    isAcc: Number(row.IsAcc) === 1,
  };
  }
  buildMeta(row) {
    return { encryptoCode: row.UrlCode, resolvedCode: row.InvestorCode };
  }
}

module.exports = ReceiptNotificationJob;