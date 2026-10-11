const ReceiptModule = require('../receipt/ReceiptModule');
const PaymentRepository = require('./PaymentRepository');
const { flag } = require('../../utils/flag');


// EXAMPLE module (NOT registered yet). To switch it on: add one line in bootstrap/modules.js.
class PaymentModule extends ReceiptModule {
  constructor(ctx) {
    super({
      ctx,
      type: 'PAYMENT',                                       // template key in config/messageTemplates.json
      label: 'Payment Receipt',
      linkTemplate: '/api/report/payment/id={code}',
      pdfRoutes: ['/report/payment/:param', '/report/payment'],
      auditPrefix: 'PAYMENT_',
      repository: new PaymentRepository(),
      tranType: 'PAYMENT',
      job: {
        notifyRm: flag(process.env.RM_NOTIFY_DEPOSIT),
        intervalMin: Number(process.env.PAYMENT_SYNC_INTERVAL_MIN || 1),
        notifySince: process.env.PAYMENT_NOTIFY_SINCE ? new Date(process.env.PAYMENT_NOTIFY_SINCE) : null,
      },
    });
  }
}

module.exports = PaymentModule;
