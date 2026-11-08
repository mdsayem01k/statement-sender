function flag(name, fallback = true) {
  const value = String(
    process.env[name] ?? fallback
  ).trim().toLowerCase();

  if (!['true', 'false'].includes(value)) {
    throw new Error(`${name} must be true or false`);
  }

  return value === 'true';
}

function positive(name, fallback, minimum) {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `${name} must be an integer >= ${minimum}`
    );
  }

  return value;
}

class GroupBatchSender {
  constructor(job) {
    this.job = job;

    this.rm = flag(
      'DEPOSITAPPROVE_RM_GROUP_BATCH_ENABLED'
    );

    this.finance = flag(
      'DEPOSITAPPROVE_FINACC_BATCH_ENABLED'
    );

    this.maxItems = positive(
      'DEPOSITAPPROVE_GROUP_BATCH_MAX_ITEMS',
      20,
      1
    );

    this.maxChars = positive(
      'DEPOSITAPPROVE_GROUP_BATCH_MAX_CHARS',
      3000,
      500
    );
  }

  enabled(role) {
    return (
      (role === 'RM_GROUP' && this.rm) ||
      (role === 'FINACC' && this.finance) ||
      (
        role === 'DEMO_GROUP' &&
        (this.rm || this.finance)
      )
    );
  }

  text(items) {
    const role = items[0].recipient.role;

    const team =
      role === 'RM_GROUP'
        ? 'RM'
        : role === 'FINACC'
          ? 'FINACC'
          : 'Demo';

    const lines = items.map(({ row }, index) => {
      const data = this.job.buildData(row);

      return (
        `${index + 1}. Investor: ${row.InvestorCode}\n` +
        `   Amount: BDT ${data.amount}\n` +
        `   Deposit date: ${data.paymentDate}`
      );
    });



    return (
        `Dear ${team} Team,\n\n` +
        `The following deposits have been approved:\n\n` +
        `${lines.join('\n\n')}\n\n` +
        `Total approvals: ${items.length}\n\n` +
        `Please verify the updated Ledger and Portfolio accordingly.\n\n` +
        `Cty Brokerage Limited`
        );
  }

  async flush(pending, stats) {
    const groups = new Map();

    for (const item of pending) {
      const key = JSON.stringify([
        item.recipient.role,
        item.recipient.groupName || ''
      ]);

      if (!groups.has(key)) {
        groups.set(key, []);
      }

      const items = groups.get(key);

      const duplicate = items.some(
        existing =>
          String(existing.row.Id) === String(item.row.Id)
      );

      if (!duplicate) {
        items.push(item);
      }
    }

    for (const items of groups.values()) {
      let part = [];

      for (const item of items) {
        if (this.text([item]).length > this.maxChars) {
          throw new Error(
            `Approval ${item.row.Id} exceeds batch character limit`
          );
        }

        const exceedsLimit =
          part.length >= this.maxItems ||
          this.text([...part, item]).length > this.maxChars;

        if (part.length && exceedsLimit) {
          await this.send(part, stats);
          part = [];
        }

        part.push(item);
      }

      if (part.length) {
        await this.send(part, stats);
      }
    }
  }

  async send(items, stats) {
    const job = this.job;
    const recipient = items[0].recipient;

    const channel = job.messageCenter.chains.GROUP
      ?.find(entry =>
        entry.channel.name === 'WHATSAPP_GROUP' &&
        entry.channel.accepts(recipient)
      )?.channel;

    if (!channel) {
      throw new Error(
        'Deposit approval group channel is not configured'
      );
    }

    const claimed = [];

    for (const item of items) {
      const claim = await job.deliveryLedger.claim(
        item.row.Id,
        recipient.role,
        'GROUP'
      );

      if (claim.allowed) {
        claimed.push({ ...item, claim });
        continue;
      }

      stats.skipped = (stats.skipped || 0) + 1;

      if (['ACCEPTED', 'SENT'].includes(claim.state)) {
        await job.persistSent(
          item.row,
          'GROUP',
          recipient.role,
          claim.channel
        );
      }
    }

    if (!claimed.length) {
      return;
    }

    const messageText = this.text(claimed);

    try {
      await channel.send({
        type: job.type,
        recipient,
        text: messageText,
        isAcc: 0
      });
    } catch (error) {
      const state =
        error.definitelyNotSent === true
          ? 'FAILED'
          : 'UNKNOWN';

      for (const item of claimed) {
        await job.deliveryLedger.record(
          item.claim,
          state,
          null,
          error.message
        );

        if (state === 'FAILED') {
          await job.repository.markRecipientFailed(
            item.row.Id,
            recipient.role,
            'GROUP',
            error.message
          );
        }
      }

      stats.failed += claimed.length;

      await this.audit(
        claimed,
        `${job.type}_GROUP_BATCH_${state}`,
        error.message
      );

      console.error(
    `[${job.name} BATCH]`,
    {
        role: recipient.role,
        groupName: recipient.groupName || 'Configured default group',
        notificationIds: claimed.map(item => item.row.Id),
        state,
        error: error.message
    }
    );

     


      return;
    }

    stats.whatsapp_group =
      (stats.whatsapp_group || 0) + 1;

    for (const item of claimed) {
      await job.deliveryLedger.record(
        item.claim,
        'ACCEPTED',
        'WHATSAPP_GROUP'
      );
    }

    for (const item of claimed) {
      await job.persistSent(
        item.row,
        'GROUP',
        recipient.role,
        'WHATSAPP_GROUP'
      );

      await job.deliveryLedger.record(
        item.claim,
        'SENT',
        'WHATSAPP_GROUP'
      );
    }

    await this.audit(
      claimed,
      `${job.type}_WHATSAPP_GROUP_SENT`,
      null
    );
  }

  async audit(items, status, errorMessage) {
    for (const { row, recipient } of items) {
      try {
        await this.job.messageCenter.audit.save({
          ...this.job.buildMeta(row),
          recipientRole: recipient.role,
          status,
          statusCode: errorMessage ? 502 : 200,
          errorMessage: errorMessage || null
        });
      } catch (error) {
        console.error(
          `[${this.job.name} BATCH AUDIT]`,
          error.message
        );
      }
    }
  }
}

module.exports = GroupBatchSender;