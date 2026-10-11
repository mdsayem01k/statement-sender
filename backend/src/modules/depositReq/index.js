const ReceiptModule = require('../receipt/ReceiptModule');
const ChequeRepository = require('./ChequeRepository');
const { flag } = require('../../utils/flag');

class DepositModule extends ReceiptModule {
  constructor(ctx) {
    super({
      ctx,
      type: 'RECEIPTREQ',                                       // message template key (same as before)
      label: 'Deposit Receipt',
      linkTemplate: '/api/report/receipt_req/id={code}',         // same link as before
      
      auditPrefix: 'RECEIPT_',
      repository: new ChequeRepository(),
      job: {
        notifyRm: flag(process.env.RM_NOTIFY_DEPOSIT),   // also send to the investor's RM
        intervalMin: Number(process.env.SYNC_INTERVAL_MIN || 1),
        notifySince: process.env.NOTIFY_SINCE ? new Date(process.env.NOTIFY_SINCE) : null,
      },
    });
  }
}

module.exports = DepositModule;