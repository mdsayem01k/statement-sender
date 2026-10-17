const NotificationJob = require('../../core/NotificationJob');

function dateText(value) {
  if (!value) {
    throw new Error(
      'CityAgent notification date is missing'
    );
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(
      'CityAgent notification date is invalid'
    );
  }

  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
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

class CityAgentJob extends NotificationJob {
  constructor(options) {
    super({
      ...options,
      type: 'CITYAGENT',
      name: 'CITYAGENT',
      link: () => '',
      emailEnabled: options.emailEnabled ?? true
    });

    this.mobileEnabled =
      options.mobileEnabled ?? true;

    this.enabled = false;
    this.active = null;
  }

  async syncSource() {
    const rows = await this.repository.fetchCandidates();

    let stored = 0;

    for (const row of rows) {
      stored += await this.repository.insertCandidate(row);
    }

    const result = {
      fetched: rows.length,
      stored,
      alreadyStored: rows.length - stored
    };

    console.log('[CITYAGENT SYNC]', result);

    return result;
  }

  buildData(row) {
    return {
      investorCode: row.InvestorCode,
      boNumber: row.BoNumber,
      agentName: row.AgentName || row.AgentRefCode,
      dateTime: dateText(
        row.SourceInTimestamp || row.InsertDate
      )
    };
  }

  buildMeta(row) {
    return {
      resolvedCode: row.InvestorCode
    };
  }

  async sendPending() {
    const stats = {
      whatsapp: 0,
      sms: 0,
      email: 0,
      failed: 0,
      skipped: 0,
      missingContact: 0
    };

    if (!this.mobileEnabled && !this.emailEnabled) {
      return stats;
    }

    const rows = await this.repository.findUnsent({
      limit: this.batchSize,
      maxRetry: this.maxRetry,
      deliveryModule: this.deliveryLedger.module,
      mobileEnabled: this.mobileEnabled,
      emailEnabled: this.emailEnabled
    });

    if (!rows.length) {
      console.log('[CITYAGENT NOTIFY]', stats);

      return stats;
    }

    const done = await this.repository.doneRecipients(
      rows.map(row => row.Id),
      this.maxRetry
    );

    const contacts = await this.repository.contacts(rows);

    const channels = [];

    if (this.mobileEnabled) {
      channels.push('MOBILE');
    }

    if (this.emailEnabled) {
      channels.push('EMAIL');
    }

    for (const row of rows) {
      const agentRefCode = String(
        row.AgentRefCode || ''
      ).trim().toLowerCase();

      const agent =
        agentRefCode && agentRefCode !== 'city'
          ? contacts.get(agentRefCode)
          : null;

      if (!agent) {
        stats.skipped++;

        console.warn(
          `[CITYAGENT SKIP] Investor ${row.InvestorCode}: ` +
          `agent reference "${row.AgentRefCode || ''}" not found`
        );

        continue;
      }

      row.AgentName =
        agent.name || row.AgentRefCode;

      const recipients = [
        ['AGENT', agent],
        ['CITYBANK', contacts.get('city')]
      ];

      for (const [role, contact] of recipients) {
        for (const via of channels) {
          const key = `${row.Id}:${role}:${via}`;

          if (done.has(key)) {
            continue;
          }

          const address =
            via === 'MOBILE'
              ? contact?.mobile
              : contact?.email;

          if (!address) {
            stats.missingContact++;

            console.error(
              `[CITYAGENT CONTACT] ` +
              `${row.InvestorCode} ${role} ${via} missing`
            );

            continue;
          }

          await this.deliver(
            row,
            via,
            {
              ...contact,
              role
            },
            stats
          );
        }
      }
    }

    console.log('[CITYAGENT NOTIFY]', stats);

    return stats;
  }

  async run() {
    if (this.running) {
      return {
        skipped: true
      };
    }

    clearTimeout(this.timer);

    this.running = true;

    this.active = (async () => {
      const result = {};

      try {
        await this.repository.ensureTables();
      } catch (error) {
        this.lastRun = {
          at: new Date(),
          error: error.message
        };

        console.error(
          '[CITYAGENT DATABASE]',
          error.message
        );

        return {
          error: error.message
        };
      }

      try {
        result.synced = await this.syncSource();
      } catch (error) {
        result.syncError = error.message;
      }

      try {
        result.sent = await this.sendPending();
      } catch (error) {
        result.sendError = error.message;
      }

      this.lastRun = {
        at: new Date(),
        ...result,
        error:
          result.syncError ||
          result.sendError ||
          null
      };

      console.log(
        '[CITYAGENT CYCLE]',
        this.lastRun
      );

      return result;
    })();

    try {
      return await this.active;
    } finally {
      this.running = false;
      this.active = null;

      if (this.enabled) {
        this.timer = setTimeout(
          () => this.run().catch(error => {
            console.error(
              '[CITYAGENT JOB]',
              error.message
            );
          }),
          this.intervalMs
        );

        this.timer.unref?.();
      }
    }
  }

  async start() {
    if (this.enabled) {
      return;
    }

    await this.repository.ensureTables();

    this.enabled = true;

    await this.run();
  }

  stop() {
    this.enabled = false;

    clearTimeout(this.timer);

    return this.active;
  }
}

module.exports = CityAgentJob;