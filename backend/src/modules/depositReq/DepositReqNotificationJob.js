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
      'DepositReq SourceInTimestamp is missing or invalid'
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

class DepositReqNotificationJob extends ReceiptNotificationJob {
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
        (this.notifyGroup && sourceDate >= this.groupSince);
      if (eligible) recipients.push({
        role: 'DEMO_GROUP',
        name: investor.name,
        groupName: this.settings.testGroup
      });
      return recipients;
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
      !c.rmGroupEnabled
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

    console.log('[RECEIPTREQ NOTIFY]', stats);

    return stats;
  }
}

module.exports = DepositReqNotificationJob;