const { generateShortUrlCode } = require('../utils/urlCode');
const { HttpError } = require('./errors');
const DeliveryLedger = require('../services/DeliveryLedger');

// Background job:  1) syncSource()  copy new rows from the source DB + give each a url code
//                  2) sendPending() send WhatsApp -> SMS fallback, and email, for every unsent row
// The flow is written once. A subclass supplies the 4 hooks marked "implement".
class NotificationJob {
  constructor({ name, type, repository, ctx, link, intervalMin = 1, notifySince = null,
                batchSize = 50, maxRetry = 5, emailEnabled = ctx.env.notify.emailEnabled, deliveryLedger = null }) {
    this.name = name;
    this.type = type;                 // message template key
    this.repository = repository;
    this.messageCenter = ctx.messageCenter;
    this.deliveryLedger = deliveryLedger || new DeliveryLedger({
      poolName: repository.poolName || 'poolPromise',
      module: `${type}:${repository.table || name}`
    });
    this.link = link;                 // (urlCode) => full URL
    this.intervalMs = intervalMin * 60 * 1000;
    this.notifySince = notifySince;
    this.batchSize = batchSize;
    this.maxRetry = maxRetry;         // after this many failed rounds a row is left alone
    this.emailEnabled = emailEnabled;
    this.notifyGroup = false;
    this.groupSince = null;
    this.notifyRm = true;            // a subclass turns it on (see ReceiptNotificationJob)
    this.running = false;
    this.timer = null;
    this.lastRun = { at: null, error: null };
  }

  /* ---- implement these ---- */
  async syncSource() { return {}; }                 // copy from the source DB; return counters for the log
  buildRecipient(/* row */) { throw new Error(`${this.name}: buildRecipient() not implemented`); } // the investor: { mobile, email, name }
  // everyone who gets this message: [{ role: 'INVESTOR', ... }, { role: 'RM', ... }]. Override to add more people.
  buildRecipients(row) { return [{ role: 'INVESTOR', ...this.buildRecipient(row) }]; }
  buildData(/* row */) { throw new Error(`${this.name}: buildData() not implemented`); }           // template values
  buildMeta(row) { return { encryptoCode: row.UrlCode, resolvedCode: null }; }                      // audit log ids

  // saves a fresh url code, retrying on the rare duplicate. true if saved.
  async withNewCode(seed, save) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await save(generateShortUrlCode(seed));
        return true;
      } catch (err) {
        if (!this.repository.isDuplicateUrlCode(err)) throw err;
      }
    }
    return false;
  }

  async sendPending() {
    const rows = await this.repository.findUnsent({
      limit: this.batchSize, maxRetry: this.maxRetry, since: this.notifySince,
      includeRm: this.notifyRm, includeGroup: this.notifyGroup, groupSince: this.groupSince, emailEnabled: this.emailEnabled, deliveryModule: this.deliveryLedger.module,
    });
    const done = await this.repository.doneRecipients(rows.map((r) => r.Id), this.maxRetry); // extra recipients already finished
    const stats = { whatsapp: 0, whatsapp_group: 0, sms: 0, email: 0, failed: 0 };

    for (const row of rows) {
      for (const person of this.buildRecipients(row)) {
        if (person.role === 'INVESTOR') {
          // investor: the flags on the notification row
          if ((row.RetryCount ?? 0) < this.maxRetry) {
            if (!row.IsSentSms && person.mobile) await this.deliver(row, 'MOBILE', person, stats);
            if (this.emailEnabled && !row.IsSentEmail && person.email) await this.deliver(row, 'EMAIL', person, stats);
          }
        } else if (person.role === 'FINACC') {
          if (!done.has(`${row.Id}:FINACC:GROUP`)) await this.deliver(row, 'GROUP', person, stats);
        } else {
          // anyone else (RM): one row per channel in NotificationRecipient
          if (person.mobile && !done.has(`${row.Id}:${person.role}:MOBILE`)) await this.deliver(row, 'MOBILE', person, stats);
          if (this.emailEnabled && person.email && !done.has(`${row.Id}:${person.role}:EMAIL`)) await this.deliver(row, 'EMAIL', person, stats);
        }
      }
    }
    if (rows.length) console.log(`[${this.name} NOTIFY] whatsapp ${stats.whatsapp}, sms ${stats.sms}, email ${stats.email}, group ${stats.whatsapp_group}, failed ${stats.failed}, skipped ${stats.skipped || 0}`);
    return stats;
  }

  async persistSent(row, via, role, channel) {
    if (role === 'INVESTOR') await this.repository.markSent(row.Id, via, channel);
    else await this.repository.markRecipientSent(row.Id, role, via, channel);
  }

  async deliver(row, via, recipient, stats) {
    const role = recipient.role || 'INVESTOR';
    const payload = {
      type: this.type,
      via,
      recipient,
      data: this.buildData(row),
      meta: { ...this.buildMeta(row), recipientRole: role }
    };
    const claim = await this.deliveryLedger.claim(row.Id, role, via);
    if (!claim.allowed) {
      stats.skipped = (stats.skipped || 0) + 1;
      if (claim.state === 'ACCEPTED' || claim.state === 'SENT') {
        try {
          await this.persistSent(row, via, role, claim.channel);
          return { via, ok: true, skipped: true, channel: claim.channel };
        } catch (error) {
          console.error(`[${this.name} PERSIST] accepted delivery needs reconciliation:`, error.message);
          return { via, ok: true, skipped: true, channel: claim.channel, persistenceError: error.message };
        }
      }
      return { via, ok: false, skipped: true, state: claim.state, error: `Delivery is ${claim.state}; no duplicate send attempted.` };
    }

    let delivered;
    try {
      delivered = await this.messageCenter.send(payload);
    } catch (error) {
      const definitelyRejected =
        error.definitelyNotSent === true ||
        (error.statusCode === 400 && /^Invalid (mobile number|email address):/.test(error.message)) ||
        (this.type === 'TRADE_CONFIRMATION' && via === 'MOBILE' && error.errorType === 'SMS_DAILY_LIMIT');
      const state = definitelyRejected ? 'FAILED' : 'UNKNOWN';
      try {
        await this.deliveryLedger.record(claim, state, null, error.message);
      } catch (persistenceError) {
        console.error(`[${this.name} PERSIST] delivery outcome could not be saved:`, persistenceError.message);
      }
      if (definitelyRejected) {
        try {
          if (role === 'INVESTOR') await this.repository.markFailed(row.Id, via, error.message);
          else await this.repository.markRecipientFailed(row.Id, role, via, error.message);
        } catch (persistenceError) {
          console.error(`[${this.name} PERSIST] failure flag could not be saved:`, persistenceError.message);
        }
      }
      stats.failed++;
      console.error(`[${this.name} NOTIFY] ${role} ${via} ${state} for ${row.Id}:`, error.message);
      return { via, ok: false, state, error: error.message };
    }

    const countKey = delivered.channel.toLowerCase();
    stats[countKey] = (stats[countKey] || 0) + 1;
    try {
      await this.deliveryLedger.record(claim, 'ACCEPTED', delivered.channel);
      await this.persistSent(row, via, role, delivered.channel);
      await this.deliveryLedger.record(claim, 'SENT', delivered.channel);
      return { via, ok: true, channel: delivered.channel, messageText: delivered.messageText };
    } catch (error) {
      console.error(`[${this.name} PERSIST] delivery accepted; automatic resend blocked:`, error.message);
      return { via, ok: true, channel: delivered.channel, messageText: delivered.messageText, persistenceError: error.message };
    }
  }

  async sendOne(id, via = 'all') {
    const row = await this.repository.findById(Number(id));
    if (!row) throw new HttpError(404, 'Record not found');
    const wanted = { mobile: ['MOBILE'], email: ['EMAIL'], all: ['MOBILE', 'EMAIL'] }[via];
    if (!wanted) throw new HttpError(400, 'via must be mobile, email or all');

    const recipient = this.buildRecipient(row);
    const stats = { whatsapp: 0, whatsapp_group: 0, sms: 0, email: 0, failed: 0 };
    const results = [];
    for (const v of wanted) {
      const missing = v === 'MOBILE' ? !recipient.mobile : !recipient.email;
      if (missing) { results.push({ via: v, ok: false, error: v === 'MOBILE' ? 'No mobile number on record' : 'No email address on record' }); continue; }
      results.push(await this.deliver(row, v, recipient, stats));
    }
    return results;
  }

  async run() {
    if (this.running) return { skipped: true };   // never two runs at once
    this.running = true;
    try {
      const synced = await this.syncSource();
      const sent = await this.sendPending();
      this.lastRun = { at: new Date(), error: null, synced, sent };
      return { synced, sent };
    } catch (err) {
      this.lastRun = { at: new Date(), error: err.message };
      console.error(`[${this.name} SYNC] failed:`, err.message);
      return { error: err.message };
    } finally {
      this.running = false;
    }
  }

  async start() {
    await this.repository.ensureTables();
    this.run();                                              // once now
    this.timer = setInterval(() => this.run(), this.intervalMs); // then on the interval
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); }

  status() { return { name: this.name, type: this.type, running: this.running, intervalMs: this.intervalMs, ...this.lastRun }; }
}

module.exports = NotificationJob;