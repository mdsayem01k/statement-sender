const ReceiptModule = require('../receipt/ReceiptModule');
const PaymentRepository = require('./PaymentRepository');
const DeliveryLedger = require('../../services/DeliveryLedger');
const PaymentNotificationJob = require('./PaymentNotificationJob');
const PaymentMessageCenter = require('./PaymentMessageCenter');
const { config } = require('./config');

class PaymentModule extends ReceiptModule {
  constructor(ctx) {
    const settings = config();
    const messageCenter = new PaymentMessageCenter(ctx.messageCenter, settings);
    super({
      ctx: { ...ctx, messageCenter },
      type: 'PAYMENT',
      label: 'Withdrawal Request',
      linkTemplate: '/api/report/payment/id={code}',
      pdfRoutes: ['/report/payment/:param', '/report/payment'],
      auditPrefix: 'PAYMENT_',
      repository: new PaymentRepository(settings),
      tranType: 'PAYMENT',
      jobClass: PaymentNotificationJob,
      job: {
        settings,
        deliveryLedger: new DeliveryLedger({
          poolName: 'poolPromise',
          module: 'PAYMENT:dbo.WithdrawalRequestNotification'
        })
      }
    });
  }
}

module.exports = PaymentModule;
