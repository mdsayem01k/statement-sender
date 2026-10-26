const NotificationJob = require('../../core/NotificationJob');
const { parseDescription } = require('./parseDescription');

const last10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);   // 8801711111111 and 01711111111 are the same phone

// sync from the source table -> create notification rows with url codes -> send (core/NotificationJob does the sending)
class ReceiptNotificationJob extends NotificationJob {
  // notifyRm: also send the same message to the investor's RM (RmMobile / RmEmail copied at sync time)
  constructor({ notifyRm = false, independentGroups = false, ...opts }) {
    super(opts);
    this.notifyGroup = !independentGroups && ['PAYMENT', 'RECEIPTREQ'].includes(this.type);
    this.notifyRm = this.notifyGroup || notifyRm;
    if (this.notifyGroup) {
      const since = String(process.env.FINACC_GROUP_NOTIFY_SINCE || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(since)) {
        throw new Error('Set FINACC_GROUP_NOTIFY_SINCE to the earliest request-insert time that should notify the Finance group (YYYY-MM-DDTHH:mm:ss).');
      }
      this.groupSince = new Date(`${since}Z`);
      if (Number.isNaN(this.groupSince.getTime())) throw new Error('Invalid FINACC_GROUP_NOTIFY_SINCE');
    }
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
    const investor = { role: 'INVESTOR', ...this.buildRecipient(row) };
    const recipients = [investor];
    if (this.notifyRm) {
      const sameMobile = last10(investor.mobile) && last10(row.RmMobile) === last10(investor.mobile);
      const sameEmail = investor.email && String(row.RmEmail || '').toLowerCase() === String(investor.email).toLowerCase();
      const rm = {
        role: 'RM',
        name: investor.name,
        mobile: this.notifyGroup ? row.RmMobile || null : sameMobile ? null : row.RmMobile || null,
        email: sameEmail ? null : row.RmEmail || null
      };
      if (rm.mobile || rm.email) recipients.push(rm);
    }
    const insertedAt = row.NotificationInsertDate ? new Date(row.NotificationInsertDate) : null;
    if (this.notifyGroup && insertedAt && insertedAt >= this.groupSince) {
      recipients.push({ role: 'FINACC', name: investor.name });
    }
    return recipients;
  }

 buildData(row) {
  const data = {
    amount: Number(row.Amount || 0).toFixed(2),
    url: this.link(row.UrlCode),
    Investor: row.InvestorCode || '',
    isAcc: Number(row.IsAcc) === 1
  };

  if (['PAYMENT', 'RECEIPTREQ'].includes(this.type)) {
    let value = row.SourceInTimestamp;

    if (typeof value === 'string') {
      value = value.trim();

      const sqlDatePattern =
        /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

      if (sqlDatePattern.test(value)) {
        value = value.replace(' ', 'T') + 'Z';
      }
    }

    const date = value ? new Date(value) : null;

    if (!date || Number.isNaN(date.getTime())) {
      throw new Error(
        `${this.type}: SourceInTimestamp is missing or invalid`
      );
    }

    const months = [
      'Jan', 'Feb', 'Mar', 'Apr',
      'May', 'Jun', 'Jul', 'Aug',
      'Sep', 'Oct', 'Nov', 'Dec'
    ];

    const day = String(
      date.getUTCDate()
    ).padStart(2, '0');

    const hour = date.getUTCHours();

    const minute = String(
      date.getUTCMinutes()
    ).padStart(2, '0');

    const period = hour >= 12 ? 'PM' : 'AM';

    data.dateTime =
      `${day} ${months[date.getUTCMonth()]} ` +
      `${date.getUTCFullYear()} ||` +
      `${hour % 12 || 12}:${minute}${period}`;
  }

  return data;
}
  buildMeta(row) {
    return { encryptoCode: row.UrlCode, resolvedCode: row.InvestorCode };
  }
}

module.exports = ReceiptNotificationJob;