const DepositReqNotificationJob = require(
  '../depositReq/DepositReqNotificationJob'
);

const GroupBatchSender = require('./GroupBatchSender');

class DepositApproveJob extends DepositReqNotificationJob {
  constructor(options) {
    super(options);

    this.groupBatchSender = new GroupBatchSender(this);
    this.pendingGroupBatches = null;
  }

  async deliver(row, via, recipient, stats) {
    if (
      this.pendingGroupBatches &&
      via === 'GROUP' &&
      this.groupBatchSender.enabled(recipient.role)
    ) {
      this.pendingGroupBatches.push({
        row,
        recipient
      });

      return { queued: true };
    }

    return super.deliver(
      row,
      via,
      recipient,
      stats
    );
  }

  async sendPending() {
    if (this.pendingGroupBatches) {
      return { skipped: 1 };
    }

    this.pendingGroupBatches = [];

    try {
      const stats = await super.sendPending();

      await this.groupBatchSender.flush(
        this.pendingGroupBatches,
        stats
      );

      console.log(
        `[${this.name} BATCH SUMMARY]`,
        stats
      );

      return stats;
    } finally {
      this.pendingGroupBatches = null;
    }
  }

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

        console.error(
          `[${this.name} SYNC] ${row.SourcePaymentID}:`,
          error.message
        );
      }
    }

    const pending = await repo.findWithoutNotification();

    for (const row of pending) {
      try {
        const ok = await this.withNewCode(
          row.InvestorCode || row.SourceId,
          code => repo.insertNotification({
            ...row,
            UrlCode: code
          })
        );

        if (ok) {
          created++;
        }
      } catch (error) {
        failed++;

        console.error(
          `[${this.name} SYNC] notification ${row.SourceId}:`,
          error.message
        );
      }
    }

    const stats = {
      fetched: rows.length,
      stored,
      created,
      failed
    };

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