const ReceiptNotificationJob = require('../receipt/ReceiptNotificationJob');

function sqlDate(value) {
  let raw = value;

  const pattern =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

  if (
    typeof raw === 'string' &&
    pattern.test(raw.trim())
  ) {
    raw = raw.trim().replace(' ', 'T') + 'Z';
  }

  const date = raw ? new Date(raw) : null;

  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(
      'Payment SourceInTimestamp is missing or invalid'
    );
  }

  return date;
}

function documentTime(value) {
  const date = sqlDate(value);

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

  return (
    `${day} ${months[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ||` +
    `${hour % 12 || 12}:${minute}${period}`
  );
}

class PaymentNotificationJob extends ReceiptNotificationJob {
  constructor({ settings, ...options }) {
    super({
      ...options,
      notifyRm: false,
      independentGroups: true,
      notifySince: settings.notifySince,
      emailEnabled: settings.emailEnabled
    });

    this.settings = settings;
    this.notifyRm = false;
    this.rmEmailEnabled = false;
    this.notifyGroup = settings.groupEnabled;
    this.groupSince = settings.groupSince;
  }

  async syncSource() {
    const repo = this.repository;
    const rows = await repo.fetchNewFromSource();
    let stored = 0;
    let created = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        stored += await repo.insertSyncRow(row);
      } catch (error) {
        failed++;
        console.error(`[${this.name} SYNC] ${row.RequisitionID}:`, error.message);
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

  buildRecipients(row) {
    const investor = {
      role: 'INVESTOR',
      ...this.buildRecipient(row)
    };

    const recipients = [investor];
    const sourceDate = sqlDate(row.SourceInTimestamp);

    const rmGroupName = String(
      row.RmWhatsappGroup ||
      ''
    ).trim();

    if (this.settings.testGroup) {
      const eligible =
        (this.settings.rmGroupEnabled && sourceDate >= this.settings.rmGroupSince) ||
        (this.notifyGroup && sourceDate >= this.groupSince) ||
        (this.settings.csdGroupEnabled && sourceDate >= this.settings.csdGroupSince);
      if (eligible) recipients.push({
        role: 'DEMO_GROUP',
        name: investor.name,
        groupName: this.settings.testGroup
      });
      return recipients;
    }

    if (this.settings.rmGroupEnabled && !rmGroupName &&
        sourceDate >= this.settings.rmGroupSince) {
      console.warn(`[${this.name} NOTIFY] RM_GROUP skipped for ${row.Id}: missing or conflicting rm_info.Whatsapp_group mapping`);
    }

    if (
      this.settings.rmGroupEnabled &&
      rmGroupName &&
      sourceDate >= this.settings.rmGroupSince
    ) {
      recipients.push({
        role: 'RM_GROUP',
        name: investor.name,
        groupName: rmGroupName
      });
    }

    if (
      this.notifyGroup &&
      sourceDate >= this.groupSince
    ) {
      recipients.push({
        role: 'FINACC',
        name: investor.name
      });
    }

    if (this.settings.csdGroupEnabled && sourceDate >= this.settings.csdGroupSince) {
      recipients.push({
        role: 'CSD',
        name: investor.name,
        groupName: this.settings.csdGroupName
      });
    }

    return recipients;
  }

  buildData(row) {
    return {
      ...super.buildData(row),
      dateTime: documentTime(row.SourceInTimestamp)
    };
  }

  async sendPending() {
    const c = this.settings;

    const stats = {
      whatsapp: 0,
      sms: 0,
      email: 0,
      whatsapp_group: 0,
      failed: 0,
      skipped: 0
    };

    if (
      !c.mobileEnabled &&
      !c.emailEnabled &&
      !c.groupEnabled &&
      !c.rmGroupEnabled &&
      !c.csdGroupEnabled
    ) {
      return stats;
    }

    const rows = await this.repository.findUnsent({
      limit: this.batchSize,
      maxRetry: this.maxRetry,
      deliveryModule: this.deliveryLedger.module
    });

    const done = await this.repository.doneRecipients(
      rows.map(row => row.Id),
      this.maxRetry
    );

    for (const row of rows) {
      try {
        this.buildData(row);
      } catch (error) {
        stats.failed++;
        console.error(`[${this.name} NOTIFY] invalid record ${row.Id}:`, error.message);
        continue;
      }
      if (
        sqlDate(row.SourceInTimestamp) < this.notifySince
      ) {
        continue;
      }

      for (const person of this.buildRecipients(row)) {
        if (person.role === 'INVESTOR') {
          if ((row.RetryCount || 0) >= this.maxRetry) {
            continue;
          }

          if (
            c.mobileEnabled &&
            person.mobile &&
            !row.IsSentSms
          ) {
            await this.deliver(
              row,
              'MOBILE',
              person,
              stats
            );
          }

          if (
            c.emailEnabled &&
            person.email &&
            !row.IsSentEmail
          ) {
            await this.deliver(
              row,
              'EMAIL',
              person,
              stats
            );
          }
        } else if (
          !done.has(`${row.Id}:${person.role}:GROUP`)
        ) {
          await this.deliver(
            row,
            'GROUP',
            person,
            stats
          );
        }
      }
    }

    console.log(`[${this.name} NOTIFY]`, stats);

    return stats;
  }
}

module.exports = PaymentNotificationJob;
